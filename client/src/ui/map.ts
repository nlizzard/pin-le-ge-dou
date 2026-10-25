import { LEVEL_COUNT, levelInfo, ROUND_NAMES } from '../core/level';
import { PATTERNS } from '../core/patterns';
import { save } from '../save';
import { orderedLevelIds } from '../levelProgress';
import type { Fx } from '../render/fx';
import { openCollection } from './collection';
import { dialog, h, starRow } from './dom';
import { Elf } from './elf';
import { openSettings } from './settings';
import { checkpointSummaries, clearCheckpoint, refreshCheckpointSummaries } from '../checkpoint';

let mapElf: Elf | null = null;
let mapIO: IntersectionObserver | null = null;
const GREETINGS = ['今天也来拼豆吧！', '欢迎回来～', '点我有惊喜哦', '集齐隐藏道具我会变金色！', '三星通关可以扭蛋哦', '一起拼到第 200 关吧！'];

/** 关卡名直接取图案名（不生成关卡，地图首屏渲染 1000+ 张卡片也毫无压力） */
function levelName(id: number): string {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const round = Math.floor((id - 1) / PATTERNS.length);
  return ROUND_NAMES[round] ? `${p.name} · ${ROUND_NAMES[round]}` : p.name;
}

/** 未通关仍保留半透明预览样式；进行中的关卡按进度在朦胧→清晰之间过渡。 */
function thumbnail(id: number, alpha: number): HTMLCanvasElement {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const grid = patternGridOf(p);
  const scale = Math.max(2, Math.floor(64 / Math.max(grid.w, grid.h)));
  const c = h('canvas.thumb') as HTMLCanvasElement;
  c.width = grid.w * scale;
  c.height = grid.h * scale;
  const ctx = c.getContext('2d')!;
  ctx.globalAlpha = alpha;
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

/** 长按卡片 1 秒后：确认删除这关的存档 */
async function confirmDropCheckpoint(id: string, progress: number, root: HTMLElement, onPlay: (id: number) => void, fx: Fx, onStudio: () => void) {
  const pct = Math.round(progress * 100);
  const v = await dialog(
    h('div', {}, h('h2', {}, id.startsWith('custom-') ? '删除这幅创作的存档？' : `删除第 ${id} 关的存档？`), h('p.hint', {}, pct > 0 ? `已拼到 ${pct}% 的进度会一起消失，删掉后只能从头再来。` : '这份进度会被删掉，删掉后只能从头再来。')),
    [{ label: '删除存档', value: 'del', cls: 'primary' }, { label: '先留着', value: 'keep' }],
    { dismissValue: 'keep' },
  );
  if (v === 'del') {
    clearCheckpoint(id);
    renderMap(root, onPlay, fx, onStudio);
  }
}

export function renderMap(root: HTMLElement, onPlay: (id: number) => void, fx: Fx, onStudio: () => void) {
  if (!mapElf) mapElf = new Elf(fx, {}, 64);
  mapElf.setSkin(save.data.elfSkin);
  const d = save.data;
  const total = Object.values(d.best).reduce((a, b) => a + b, 0);
  const cps = checkpointSummaries();
  const done = (id: number) => (d.best[id] ?? 0) > 0;

  // 从未通关、但有存档进度的关卡，挪到已通关区块的后面（其余顺序不变）
  const base = orderedLevelIds(d, LEVEL_COUNT);
  const doneCount = base.filter(done).length;
  const ongoing = base.filter((id) => !done(id) && cps.has(String(id)));
  const ongoingSet = new Set(ongoing);
  const ordered = [...base.slice(0, doneCount), ...ongoing, ...base.slice(doneCount).filter((id) => !ongoingSet.has(id))];

  // 懒加载：首屏只渲染骨架（编号/名字/星级都是现成数据），缩略图和难度标签滚动到附近再补
  mapIO?.disconnect();
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const cardEl = en.target as HTMLElement;
      io.unobserve(cardEl);
      const id = Number(cardEl.dataset.id);
      const best = d.best[id] ?? 0;
      const cp = cps.get(String(id));
      const alpha = best ? 1 : cp ? 0.35 + Math.min(0.65, cp.progress * 0.65) : 0.35;
      cardEl.querySelector('.thumb-slot')?.replaceWith(thumbnail(id, alpha));
      if (best || cp) {
        const info = levelInfo(id); // 需要生成关卡才能知道难度，只对进入视野的卡片算
        cardEl.append(h('div.tag.diff-' + info.difficulty, {}, info.difficulty));
      }
      cardEl.classList.add('loaded');
    }
  }, { rootMargin: '600px 0px' });
  mapIO = io;

  const list = h('div.level-grid');
  for (const id of ordered) {
    const best = d.best[id] ?? 0;
    const cp = cps.get(String(id));
    const isOngoing = !best && cp;
    const unplayed = !best && !isOngoing;
    let pressFired = false;
    let pressTimer = 0;
    const card = h(
      'button.level-card' + (unplayed ? '.unplayed' : '') + (isOngoing ? '.ongoing' : ''),
      {
        'data-id': String(id),
        onclick: () => {
          if (pressFired) { pressFired = false; return; } // 长按删档后松手附带的点击，忽略
          onPlay(id);
        },
        onpointerdown: () => {
          if (!cp) return; // 没有存档的卡片不长按
          pressFired = false;
          clearTimeout(pressTimer);
          card.classList.add('pressing');
          pressTimer = window.setTimeout(() => {
            pressFired = true;
            card.classList.remove('pressing');
            void confirmDropCheckpoint(String(id), cp.progress, root, onPlay, fx, onStudio);
          }, 1000);
        },
        onpointerup: () => { clearTimeout(pressTimer); card.classList.remove('pressing'); },
        onpointerleave: () => { clearTimeout(pressTimer); card.classList.remove('pressing'); },
        onpointercancel: () => { clearTimeout(pressTimer); card.classList.remove('pressing'); },
        'aria-label': `第${id}关${unplayed ? ' · 未通关' : isOngoing ? ` · 拼到 ${Math.round(cp!.progress * 100)}%` : ` · ${levelName(id)}`}${cp ? '，长按可删除存档' : ''}`,
        title: isOngoing ? `上次拼到 ${Math.round(cp!.progress * 100)}%，点我继续` : best && cp ? '这关重玩中的进度已保存，进入可继续' : undefined,
      },
      isOngoing ? h('span.ongoing-tag', {}, '▶ 继续拼') : null,
      best && cp ? h('span.ckpt-badge', {}, '💾') : null,
      h('div.level-no', {}, String(id)),
      h('div.thumb-slot', { 'aria-hidden': 'true' }),
      h('div.level-name', {}, unplayed ? '？？？' : levelName(id)),
      isOngoing
        ? h('div.ckpt-progress', {}, h('i', { style: { width: Math.round(cp!.progress * 100) + '%' } }), h('small', {}, `已拼 ${Math.round(cp!.progress * 100)}%`))
        : unplayed ? null : starRow(best),
    );
    io.observe(card);
    list.append(card);
  }
  root.replaceChildren(
    h(
      'div.map-screen',
      {},
      h(
        'header.map-header',
        {},
        h('div.logo', {}, h('span.logo-main', {}, '拼了个豆'), h('span.logo-sub', {}, '✿ PIN LE GE DOU ✿')),
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
      h(
        'div.map-fab',
        {},
        h('button.map-fab-btn', { title: '回到顶部', 'aria-label': '回到顶部', onclick: () => root.querySelector('.map-screen')?.scrollTo({ top: 0, behavior: 'smooth' }) }, '⬆'),
        h('button.map-fab-btn', {
          title: '跳到通关进度分界', 'aria-label': '跳到通关进度分界',
          onclick: () => root.querySelector('.level-card.ongoing, .level-card.unplayed')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        }, '✿'),
      ),
      h('p.map-foot', {}, `${LEVEL_COUNT} 关等你拼 · 难度慢慢升温 · 超时通关只得半星 · 重玩可刷新最高星级`),
    ),
  );
  setTimeout(() => mapElf?.say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], 2600, true), 600);
  // 联网刷新存档摘要（本地 + SQLite 取较新），有变化就重排一次地图
  void refreshCheckpointSummaries().then((changed) => {
    if (changed && root.querySelector('.map-screen')) renderMap(root, onPlay, fx, onStudio);
  });
}
