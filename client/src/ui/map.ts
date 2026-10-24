import { LEVEL_COUNT, levelInfo } from '../core/level';
import { PATTERNS } from '../core/patterns';
import { save } from '../save';
import type { Fx } from '../render/fx';
import { openCollection } from './collection';
import { h, starRow } from './dom';
import { Elf } from './elf';
import { openSettings } from './settings';

let mapElf: Elf | null = null;
const GREETINGS = ['今天也来拼豆吧！', '欢迎回来～', '点我有惊喜哦', '集齐隐藏道具我会变金色！', '三星通关可以扭蛋哦', '一起拼到第 200 关吧！'];

/** 关卡缩略图：每格画成 1 个像素块；锁定关卡画半透明真彩色预览（看得见但还没解锁） */
function thumbnail(id: number, locked: boolean): HTMLCanvasElement {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const grid = patternGridOf(p);
  const scale = Math.max(2, Math.floor(64 / Math.max(grid.w, grid.h)));
  const c = h('canvas.thumb') as HTMLCanvasElement;
  c.width = grid.w * scale;
  c.height = grid.h * scale;
  const ctx = c.getContext('2d')!;
  ctx.globalAlpha = locked ? 0.35 : 1;
  for (let i = 0; i < grid.target.length; i++) {
    const t = grid.target[i];
    if (t < 0) continue;
    ctx.fillStyle = grid.colors[t];
    ctx.fillRect((i % grid.w) * scale, Math.floor(i / grid.w) * scale, scale, scale);
  }
  return c;
}

/** patternToGrid 带缓存：200 张卡片反复渲染地图时不再重复解析 */
const gridCache = new Map<string, { w: number; h: number; colors: string[]; target: Int16Array }>();
function patternGridOf(p: (typeof PATTERNS)[number]) {
  let g = gridCache.get(p.key);
  if (!g) {
    const h = p.rows.length;
    const w = Math.max(...p.rows.map(r => r.length));
    const colors: string[] = [];
    const charIndex = new Map<string, number>();
    const target = new Int16Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) {
      const row = p.rows[y].padEnd(w, '.');
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        let idx = charIndex.get(ch);
        if (idx === undefined) {
          idx = colors.length;
          colors.push(p.palette[ch]);
          charIndex.set(ch, idx);
        }
        target[y * w + x] = idx;
      }
    }
    g = { w, h, colors, target };
    gridCache.set(p.key, g);
  }
  return g;
}

export function renderMap(root: HTMLElement, onPlay: (id: number) => void, fx: Fx, onStudio: () => void) {
  if (!mapElf) mapElf = new Elf(fx, {}, 64);
  mapElf.setSkin(save.data.elfSkin);
  const d = save.data;
  const total = Object.values(d.best).reduce((a, b) => a + b, 0);
  const list = h('div.level-grid');
  for (let id = 1; id <= LEVEL_COUNT; id++) {
    const locked = id > d.unlocked;
    const info = levelInfo(id);
    const best = d.best[id] ?? 0;
    const card = h(
      'button.level-card' + (locked ? '.locked' : '') + (id === d.unlocked && !best ? '.current' : ''),
      { onclick: () => !locked && onPlay(id), disabled: locked || undefined },
      h('div.level-no', {}, String(id)),
      thumbnail(id, locked),
      h('div.level-name', {}, locked ? '？？？' : info.name),
      locked ? h('div.lock', {}, '🔒') : starRow(best),
      locked ? null : h('div.tag.diff-' + info.difficulty, {}, info.difficulty),
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
        h('div.logo', {}, h('span.logo-main', {}, '拼豆归位'), h('span.logo-sub', {}, '✿ PICTURE PLAY ✿')),
        h('div.total-stars', {}, '★ ', String(total), h('span.dim', {}, ` / ${LEVEL_COUNT * 3}`)),
        h('button.icon-btn', { onclick: () => openCollection().then(() => mapElf?.setSkin(save.data.elfSkin)), title: '背包 · 图鉴' }, '🎒'),
        h('button.icon-btn', { onclick: () => openSettings(), title: '设置' }, '⚙'),
        h('div.map-elf', {}, mapElf.el),
      ),
      h(
        'button.studio-entry',
        { onclick: onStudio },
        h('span.studio-entry-icon', {}, '🎀'),
        h('span.studio-entry-text', {}, h('b', {}, '我的小画室'), h('small', {}, '上传图片自由创作 · 作品收藏上墙 · 制作分享手账')),
        h('span.studio-entry-go', {}, '走进去 ↗'),
      ),
      list,
      h('p.map-foot', {}, `${LEVEL_COUNT} 关等你拼 · 难度慢慢升温 · 超时通关只得半星 · 重玩可刷新最高星级`),
    ),
  );
  root.querySelector('.level-card.current')?.scrollIntoView({ block: 'center' });
  setTimeout(() => mapElf?.say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], 2600, true), 600);
}
