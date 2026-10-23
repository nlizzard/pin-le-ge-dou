import { buildLevel, LEVEL_COUNT, patternToGrid } from '../core/level';
import { PATTERNS } from '../core/patterns';
import { save } from '../save';
import type { Fx } from '../render/fx';
import { openCollection } from './collection';
import { h, starRow } from './dom';
import { Elf } from './elf';
import { openSettings } from './settings';

let mapElf: Elf | null = null;
const GREETINGS = ['今天也来拼豆吧！', '欢迎回来～', '点我有惊喜哦', '集齐隐藏道具我会变金色！', '三星通关可以扭蛋哦'];

/** 关卡缩略图：每格画成 1 个像素块 */
function thumbnail(id: number, locked: boolean): HTMLCanvasElement {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const g = patternToGrid(p);
  const scale = Math.max(2, Math.floor(64 / Math.max(g.w, g.h)));
  const c = h('canvas.thumb') as HTMLCanvasElement;
  c.width = g.w * scale;
  c.height = g.h * scale;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < g.target.length; i++) {
    const t = g.target[i];
    if (t < 0) continue;
    ctx.fillStyle = locked ? '#c9c5dd' : g.colors[t];
    ctx.fillRect((i % g.w) * scale, Math.floor(i / g.w) * scale, scale, scale);
  }
  return c;
}

export function renderMap(root: HTMLElement, onPlay: (id: number) => void, fx: Fx) {
  if (!mapElf) mapElf = new Elf(fx, {}, 64);
  mapElf.setSkin(save.data.elfSkin);
  const d = save.data;
  const total = Object.values(d.best).reduce((a, b) => a + b, 0);
  const list = h('div.level-grid');
  for (let id = 1; id <= LEVEL_COUNT; id++) {
    const locked = id > d.unlocked;
    const def = buildLevel(id);
    const best = d.best[id] ?? 0;
    const card = h(
      'button.level-card' + (locked ? '.locked' : '') + (id === d.unlocked && !best ? '.current' : ''),
      { onclick: () => !locked && onPlay(id), disabled: locked || undefined },
      h('div.level-no', {}, String(id)),
      thumbnail(id, locked),
      h('div.level-name', {}, locked ? '？？？' : def.name),
      locked ? h('div.lock', {}, '🔒') : starRow(best),
      locked ? null : h('div.tag.diff-' + def.difficulty, {}, def.difficulty),
    );
    list.append(card);
  }
  root.replaceChildren(
    h(
      'div.map-screen',
      {},
      h(
        'header.map-header',
        {},
        h('div.logo', {}, h('span.logo-main', {}, '拼豆归位'), h('span.logo-sub', {}, 'Picture Play')),
        h('div.total-stars', {}, '★ ', String(total), h('span.dim', {}, ` / ${LEVEL_COUNT * 3}`)),
        h('button.icon-btn', { onclick: () => openCollection().then(() => mapElf?.setSkin(save.data.elfSkin)), title: '背包 · 图鉴' }, '🎒'),
        h('button.icon-btn', { onclick: () => openSettings(), title: '设置' }, '⚙'),
        h('div.map-elf', {}, mapElf.el),
      ),
      list,
      h('p.map-foot', {}, '通关解锁下一关 · 超时通关只得半星 · 重玩可刷新最高星级'),
    ),
  );
  root.querySelector('.level-card.current')?.scrollIntoView({ block: 'center' });
  setTimeout(() => mapElf?.say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], 2600, true), 600);
}
