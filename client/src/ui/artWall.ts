import {
  STICKERS, STICKER_EMOJI, WALLPAPERS, deleteWork, emptyWall, listRecycle, loadStudio, normalizeWall, rememberArtwork,
  restoreWork, saveStudioDoc, studioCached, updateWorkOptions, workShareData,
  type RecycleEntry, type StickerInstance, type StudioDoc, type WallDef, type WallItem, type WallWork,
} from '../artWallStore';
import { renderShareCard } from '../render/shareCard';
import { drawArtwork } from '../render/artwork';
import { LEVEL_COUNT, type LevelDef } from '../core/level';
import { PATTERNS } from '../core/patterns';
import { save } from '../save';
import { clearCheckpoint, checkpointSummaries, loadCheckpoint, refreshCheckpointSummaries, type CkptSummary } from '../checkpoint';
import { dialog, h, toast } from './dom';
import { openShareStudio } from './share';

/* ---------- 小画室：无限画布式作品墙 ----------
 * 空白处拖动平移、滚轮/双指缩放整面墙；点选作品或贴纸后：
 * 拖动移动、顶部圆钮按住旋转（像 Word）、双指捏合改大小；底部抽屉提供
 * 作品（创作 + 已通关图案）、贴纸（静态/动态/胶带）与墙纸。多面墙独立保存。 */

type Selection = { type: 'item'; item: WallItem } | { type: 'sticker'; sticker: StickerInstance } | null;

const VIEW_MIN = 0.1, VIEW_MAX = 5;

export function renderArtWall(root: HTMLElement, host: { toMap(): void; create(): void; play?(def: LevelDef): void }): () => void {
  let disposed = false;
  let works: WallWork[] = [];
  let doc: StudioDoc = { walls: [], activeWallId: '' };
  let wall: WallDef | null = null;
  let view = { x: -80, y: -60, scale: 0.85 };
  let selection: Selection = null;
  let saveTimer = 0;
  let recycle: RecycleEntry[] = [];
  let panel: 'works' | 'stickers' | 'wallpaper' | null = 'works';
  const artCache = new Map<string, string>(); // workId → dataURL

  const status = h('p.wall-status', { role: 'status' }, '正在打开你的小画室…');
  const world = h('div.studio-world') as HTMLDivElement;
  const canvasEl = h('div.studio-canvas', { 'aria-label': '作品墙画布：空白处拖动平移，双指或滚轮缩放' }, world) as HTMLDivElement;
  const tabsEl = h('div.studio-wall-tabs');
  const panelEl = h('div.studio-panel');
  const inspectorEl = h('div.studio-inspector');
  const sidebarEl = h('aside.studio-sidebar', {},
    h('div.studio-sidebar-head', {}, h('b', {}, '素材与布置'), h('span', {}, '作品 · 贴纸 · 墙纸')),
    panelEl);
  const zoomLabel = h('span.studio-zoom-val', {}, Math.round(view.scale * 100) + '%');

  function activeWall(): WallDef {
    return wall ?? doc.walls[0];
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveStudioDoc(doc).then(() => { if (!disposed) status.textContent = '已自动保存到本地存档 ✿'; }).catch((e) => {
        if (!disposed) status.textContent = e instanceof Error ? `尚未保存：${e.message}` : '尚未保存，会自动重试';
      });
    }, 900);
  }

  function bumpZ(): number {
    const w = activeWall();
    return Math.max(0, ...w.items.map(i => i.z), ...w.stickers.map(s => s.z)) + 1;
  }

  /* ---------- 作品画布：创作默认走分享卡相框；关卡用白卡粉框；均可一键去框 ---------- */
  function patternGridOfPattern(p: (typeof PATTERNS)[number]) {
    const hh = p.rows.length, ww = Math.max(...p.rows.map(r => r.length));
    const colors: string[] = [], idx = new Map<string, number>();
    const target = new Int16Array(ww * hh).fill(-1);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      const ch = p.rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      if (!idx.has(ch)) { idx.set(ch, colors.length); colors.push(p.palette[ch]); }
      target[y * ww + x] = idx.get(ch)!;
    }
    return { w: ww, h: hh, colors, target };
  }

  function artUrl(workId: string, framed = true): string {
    const cacheKey = workId + (framed ? '' : '|bare');
    let url = artCache.get(cacheKey);
    if (url) return url;
    if (workId.startsWith('level-')) {
      const id = Number(workId.slice(6));
      const p = PATTERNS[(id - 1) % PATTERNS.length];
      const grid = patternGridOfPattern(p);
      if (!framed) {
        // 无框：只留像素画本体（白底小卡）
        const c = document.createElement('canvas');
        c.width = 324; c.height = 324;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 324, 324);
        drawArtwork(ctx, grid, 16, 16, 292, 292);
        url = c.toDataURL('image/jpeg', 0.9);
      } else {
        const full = document.createElement('canvas');
        full.width = 324; full.height = 432;
        const ctx = full.getContext('2d')!;
        ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 324, 432);
        ctx.strokeStyle = '#f2c9d9'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 318, 426);
        drawArtwork(ctx, grid, 42, 40, 240, 300);
        ctx.fillStyle = '#b06e8c';
        ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, 162, 404);
        url = full.toDataURL('image/jpeg', 0.9);
      }
    } else {
      const w = works.find(x => x.id === workId);
      if (!w) return '';
      if (framed) {
        const full = document.createElement('canvas');
        renderShareCard(full, workShareData(w), w.options);
        const small = document.createElement('canvas');
        small.width = 324; small.height = full.height * (324 / full.width);
        small.getContext('2d')!.drawImage(full, 0, 0, small.width, small.height);
        url = small.toDataURL('image/jpeg', 0.9);
      } else {
        // 无框：直接画原始像素图（白底小卡，保留作品比例）
        const ratio = w.grid.h / w.grid.w;
        const c = document.createElement('canvas');
        c.width = 324; c.height = Math.max(80, Math.min(640, Math.round(324 * ratio)));
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, c.width, c.height);
        drawArtwork(ctx, w.grid, 12, 12, c.width - 24, c.height - 24);
        url = c.toDataURL('image/jpeg', 0.9);
      }
    }
    artCache.set(cacheKey, url);
    return url;
  }

  /* ---------- 渲染 ---------- */

  function itemSizePx(item: WallItem): number {
    return item.size;
  }

  function renderWallContent() {
    const w = activeWall();
    world.replaceChildren();
    canvasEl.dataset.wallpaper = w.wallpaper;
    for (const item of w.items) {
      if (!item.onWall) continue;
      const el = h('div.studio-item' + (selection?.type === 'item' && selection.item === item ? '.selected' : ''),
        { 'data-item': item.workId, style: { left: item.x + 'px', top: item.y + 'px', width: itemSizePx(item) + 'px', transform: `rotate(${item.rotation}deg)`, zIndex: item.z } },
        h('img', { src: artUrl(item.workId, item.frame !== false), alt: '作品', draggable: false }),
        selection?.type === 'item' && selection.item === item ? h('div.studio-rotate-handle', { 'data-rotate': item.workId, title: '按住拖动旋转' }, '⟳') : null,
      );
      world.append(el);
    }
    for (const s of w.stickers) {
      world.append(h('div.studio-sticker' + (selection?.type === 'sticker' && selection.sticker === s ? '.selected' : '') + ' .sk-' + s.kind,
        { 'data-sticker': s.id, style: { left: s.x + 'px', top: s.y + 'px', transform: `rotate(${s.rotation}deg) scale(${s.scale})`, zIndex: s.z } },
        stickerBody(s)));
    }
    if (!w.items.some(i => i.onWall) && !w.stickers.length) {
      world.append(h('div.studio-empty-hint', { style: { left: view.x < 0 ? -view.x / view.scale + 40 + 'px' : '40px', top: view.y < 0 ? -view.y / view.scale + 40 + 'px' : '40px' } },
        h('span', {}, '🫧'), h('p', {}, '空空的墙面～'), h('small', {}, '从下方「作品 / 贴纸」里挑点喜欢的贴上来吧')));
    }
  }

  function stickerBody(s: StickerInstance): Node {
    if (s.kind.startsWith('tape-')) {
      const colors: Record<string, string[]> = { 'tape-pink': ['#ffd9e5', '#ff9db8'], 'tape-mint': ['#d5efe6', '#8fd8c0'], 'tape-lav': ['#e5dcf7', '#b9a6ec'], 'tape-cream': ['#f7ecd8', '#e8cf9e'] };
      const c = colors[s.kind] ?? colors['tape-pink'];
      return h('div.tape', { style: { background: `repeating-linear-gradient(45deg, ${c[0]}, ${c[0]} 6px, ${c[1]} 6px, ${c[1]} 12px)` } });
    }
    if (s.kind === 'lights') return h('div.lights', {}, ...Array.from({ length: 7 }, (_, i) => h('i', { style: { animationDelay: (i * 0.28) + 's' } })));
    if (s.kind === 'shimmer') return h('div.shimmer');
    return h('span', {}, STICKER_EMOJI[s.kind] ?? '✨');
  }

  function applyView() {
    view.scale = Math.max(VIEW_MIN, Math.min(VIEW_MAX, view.scale));
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  }

  /** 缩放保持画布中某点不动（以画布内坐标 cx,cy 为锚） */
  function zoomAt(next: number, cx: number, cy: number) {
    next = Math.max(VIEW_MIN, Math.min(VIEW_MAX, next));
    const k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    applyView();
  }

  /** 视野缩到能看到全部作品和贴纸，居中显示 */
  function zoomToFit() {
    const w = activeWall();
    const els = [...w.items.filter(i => i.onWall), ...w.stickers];
    if (!els.length) { view = { x: -80, y: -60, scale: 0.85 }; applyView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of w.items.filter(x => x.onWall)) {
      minX = Math.min(minX, i.x); minY = Math.min(minY, i.y);
      maxX = Math.max(maxX, i.x + i.size); maxY = Math.max(maxY, i.y + i.size * 4 / 3);
    }
    for (const s of w.stickers) {
      minX = Math.min(minX, s.x - 60); minY = Math.min(minY, s.y - 60);
      maxX = Math.max(maxX, s.x + 120); maxY = Math.max(maxY, s.y + 120);
    }
    const r = canvasEl.getBoundingClientRect();
    const pad = 70;
    const scale = Math.max(VIEW_MIN, Math.min(1.6, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY))));
    view.scale = scale;
    view.x = (r.width - (maxX - minX) * scale) / 2 - minX * scale;
    view.y = (r.height - (maxY - minY) * scale) / 2 - minY * scale;
    applyView();
  }

  function renderTabs() {
    tabsEl.replaceChildren(
      ...doc.walls.map(w => h('button.studio-tab' + (w.id === doc.activeWallId ? '.active' : ''),
        { onclick: () => switchWall(w.id), ondblclick: () => void renameWall(w) },
        h('span', {}, w.name))),
      h('button.studio-tab.add', { title: '新建作品墙', onclick: () => void addWall() }, '＋'),
      h('button.studio-tab.manage', { title: '重命名 / 删除当前墙', onclick: () => void manageWall() }, '⋯'),
    );
  }

  function renderInspector() {
    const sel = selection;
    if (!sel) {
      inspectorEl.replaceChildren(h('div.studio-inspect-tip', {}, '点选墙上的作品或贴纸：拖动移动 · 圆钮⟳旋转 · 双指捏合缩放'));
      return;
    }
    if (sel.type === 'sticker') {
      const s = sel.sticker;
      const size = h('input', { type: 'range', min: 40, max: 600, value: Math.round(s.scale * 100), 'aria-label': '贴纸大小' }) as HTMLInputElement;
      const rot = h('input', { type: 'range', min: -180, max: 180, value: s.rotation, 'aria-label': '贴纸角度' }) as HTMLInputElement;
      size.oninput = () => { s.scale = +size.value / 100; renderWallContent(); scheduleSave(); };
      rot.oninput = () => { s.rotation = +rot.value; renderWallContent(); scheduleSave(); };
      inspectorEl.replaceChildren(
        h('label', {}, '大小 ', size), h('label', {}, '角度 ', rot),
        h('button.btn.small.danger', { onclick: () => { const w = activeWall(); w.stickers = w.stickers.filter(x => x.id !== s.id); selection = null; renderWallContent(); renderInspector(); scheduleSave(); } }, '🗑 删除贴纸'));
      return;
    }
    const item = sel.item;
    const isLevel = item.workId.startsWith('level-');
    const work = works.find(w => w.id === item.workId);
    const size = h('input', { type: 'range', min: 90, max: 900, value: item.size, 'aria-label': '作品大小' }) as HTMLInputElement;
    const rot = h('input', { type: 'range', min: -180, max: 180, value: item.rotation, 'aria-label': '作品角度' }) as HTMLInputElement;
    size.oninput = () => { item.size = +size.value; renderWallContent(); scheduleSave(); };
    rot.oninput = () => { item.rotation = +rot.value; renderWallContent(); scheduleSave(); };
    inspectorEl.replaceChildren(
      h('div.studio-inspect-name', {}, work?.name ?? (isLevel ? '关卡图案' : item.workId)),
      h('label', {}, '大小 ', size), h('label', {}, '角度 ', rot),
      h('button.btn.small', { onclick: () => { item.frame = item.frame === false; renderWallContent(); renderInspector(); scheduleSave(); toast(item.frame === false ? '已取下相框' : '已加上相框'); } }, item.frame === false ? '🖼 恢复相框' : '🖼 取下相框'),
      ...(!isLevel && work ? [h('button.btn.small', { onclick: () => void reframe(work!) }, '✧ 换相框样式 / 下载')] : []),
      h('button.btn.small', { onclick: () => { item.onWall = false; selection = null; renderWallContent(); renderInspector(); renderPanel(); scheduleSave(); toast('已收进抽屉，可从「作品」里再贴回来'); } }, '📥 收进抽屉'),
    );
  }

  async function reframe(work: WallWork) {
    await openShareStudio(workShareData(work), {
      initial: work.options, backLabel: '返回小画室', saveLabel: '保存相框到小画室',
      onSave: async options => { await updateWorkOptions(work.id, options); work.options = { ...options }; artCache.delete(work.id); renderWallContent(); },
    });
  }

  /* ---------- 底部抽屉：作品 / 贴纸 / 墙纸 ---------- */

  function completedLevels(): number[] {
    const ids: number[] = [];
    for (let id = 1; id <= LEVEL_COUNT; id++) if ((save.data.best[id] ?? 0) > 0) ids.push(id);
    return ids;
  }

  function addToCenter(workId: string) {
    const w = activeWall();
    if (w.items.some(i => i.workId === workId)) {
      const it = w.items.find(i => i.workId === workId)!;
      if (it.onWall) { toast('它已经在这面墙上啦'); selection = { type: 'item', item: it }; renderWallContent(); renderInspector(); return; }
      it.onWall = true;
    } else {
      const rect = canvasEl.getBoundingClientRect();
      const cx = (rect.width / 2 - view.x) / view.scale - 130;
      const cy = (rect.height / 2 - view.y) / view.scale - 170;
      w.items.push({ workId, x: Math.round(cx), y: Math.round(cy), size: 260, rotation: (w.items.length % 2 ? 2 : -2), z: bumpZ(), onWall: true });
    }
    selection = { type: 'item', item: w.items.find(i => i.workId === workId)! };
    renderWallContent(); renderInspector(); scheduleSave();
  }

  function renderPanel() {
    const head = (t: string, key: typeof panel) => h('button.studio-panel-tab' + (panel === key ? '.active' : ''), { onclick: () => { panel = key; renderPanel(); } }, t);
    const tabs = h('div.studio-panel-tabs', {}, head('🖼 作品', 'works'), head('✿ 贴纸', 'stickers'), head('🧁 墙纸', 'wallpaper'));
    if (panel === 'works') {
      const mine = h('div.studio-panel-row', {},
        h('small', {}, '我的创作'),
        ...works.map(wk => h('div.studio-chip-art',
          { title: wk.name + '（点击贴上墙 · ✕ 删除作品）' },
          h('img', { src: artUrl(wk.id), alt: wk.name, draggable: false, onclick: () => addToCenter(wk.id) }),
          h('button.studio-chip-x', { title: '删除这幅作品（进回收站，30 天内可恢复）', onclick: () => void removeWork(wk.id) }, '✕'),
          h('span', {}, wk.name))));
      // 未完成的创作：自定义作品的中断进度，点击直接续拼
      const drafts = [...checkpointSummaries().values()].filter(s => s.levelId.startsWith('custom-')).sort((a, b) => b.savedAt - a.savedAt);
      const draftRow = h('div.studio-panel-row', {},
        h('small', {}, '未完成的创作'),
        drafts.length ? null : h('em', {}, '拼到一半的创作会出现在这里'),
        ...drafts.map(s => h('div.studio-chip.draft-chip', { title: `${s.name ?? '我的创作'} · 已拼 ${Math.round(s.progress * 100)}% · 点击继续拼` },
          h('span.draft-emoji', {}, '📝'),
          h('span', {}, `${(s.name ?? '我的创作').slice(0, 10)} ${Math.round(s.progress * 100)}%`),
          h('button.studio-chip-x', { title: '放弃这份进度', onclick: () => void dropDraft(s) }, '✕'),
          h('button.draft-go', { onclick: () => void resumeDraft(s) }, '继续拼 ▶'))));
      const levels = completedLevels();
      const levelRow = h('div.studio-panel-row', {},
        h('small', {}, '已通关图案'),
        levels.length ? null : h('em', {}, '通关后这里会出现对应图案'),
        ...levels.map(id => {
          const p = PATTERNS[(id - 1) % PATTERNS.length];
          const c = h('canvas', { width: 40, height: 40, title: `第${id}关 · ${p.name}`, onclick: () => addToCenter('level-' + id) }) as HTMLCanvasElement;
          const ctx = c.getContext('2d')!;
          const hh = p.rows.length, ww = Math.max(...p.rows.map(r => r.length));
          const s = Math.max(1, Math.floor(40 / Math.max(ww, hh)));
          for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
            const ch = p.rows[y][x];
            if (ch === '.' || ch === ' ') continue;
            ctx.fillStyle = p.palette[ch];
            ctx.fillRect(x * s + (40 - ww * s) / 2, y * s + (40 - hh * s) / 2, s, s);
          }
          return h('div.studio-chip', { onclick: () => addToCenter('level-' + id), title: `第${id}关 · ${p.name}` }, c, h('span', {}, p.name));
        }));
      // 回收站：误删的作品 30 天内可恢复
      const recycleRow = h('details.studio-recycle', {},
        h('summary', {}, `🗑 回收站${recycle.length ? ` · ${recycle.length}` : ''}`),
        recycle.length
          ? h('div.studio-panel-row', {}, ...recycle.map(r => h('div.studio-chip.draft-chip', {},
              h('span', {}, `${r.name.slice(0, 10)} · ${Math.round((Date.now() - r.deletedAt) / 86400_000)} 天前删`),
              h('button.draft-go', { onclick: () => void restoreFromRecycle(r) }, '恢复'))))
          : h('p.hint', {}, '空空的～删除的作品会在这里保留 30 天'));
      panelEl.replaceChildren(tabs, draftRow, mine, levelRow, recycleRow);
      return;
    }
    if (panel === 'stickers') {
      const groups: [string, typeof STICKERS][] = [['静态贴纸', STICKERS.filter(s => s.group === 'static')], ['动态效果', STICKERS.filter(s => s.group === 'anim')], ['和纸胶带', STICKERS.filter(s => s.group === 'tape')]];
      panelEl.replaceChildren(tabs, ...groups.map(([name, list]) => h('div.studio-panel-row', {}, h('small', {}, name),
        ...list.map(s => h('button.studio-chip.sticker-chip' + (s.group === 'anim' ? '.anim' : ''), { title: s.name + ' · 点击贴上墙', onclick: () => addSticker(s.kind) },
          s.group === 'tape' ? h('i.tape-mini.t-' + s.kind.slice(5)) : s.kind === 'lights' ? h('i.lights-mini') : h('span', {}, STICKER_EMOJI[s.kind] ?? '✨'), h('span', {}, s.name))))));
      return;
    }
    panelEl.replaceChildren(tabs, h('div.studio-panel-row', {}, h('small', {}, '当前墙面的墙纸'),
      ...WALLPAPERS.map(wp => h('button.studio-chip.wp-' + wp.id + (activeWall().wallpaper === wp.id ? '.active' : ''), { onclick: () => { activeWall().wallpaper = wp.id; renderWallContent(); renderPanel(); scheduleSave(); } }, h('span', {}), wp.name))));
  }

  function addSticker(kind: string) {
    const w = activeWall();
    const rect = canvasEl.getBoundingClientRect();
    const cx = (rect.width / 2 - view.x) / view.scale - 40;
    const cy = (rect.height / 2 - view.y) / view.scale - 40;
    const s: StickerInstance = { id: 'st-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, x: Math.round(cx), y: Math.round(cy), scale: 1, rotation: 0, z: bumpZ() };
    w.stickers.push(s);
    selection = { type: 'sticker', sticker: s };
    renderWallContent(); renderInspector(); scheduleSave();
  }

  async function removeWork(id: string) {
    const work = works.find(w => w.id === id);
    const name = work?.name ?? '这幅作品';
    // 守护：还挂在墙上的先收下来
    const onWalls = doc.walls.filter(w => w.items.some(i => i.workId === id && i.onWall)).map(w => w.name);
    if (onWalls.length) {
      await dialog(h('div', {}, h('h2', {}, '先把它从墙上收下来'), h('p.hint', {}, `这幅作品还贴在这些墙上：${onWalls.join('、')}。请先到每面墙选中它并「收进抽屉」，再删除。`)), [{ label: '知道啦', value: 'ok', cls: 'primary' }]);
      return;
    }
    const v = await dialog(
      h('div', {}, h('h2', {}, `删除《${name}》？`), h('p.hint', {}, '删除后会进入回收站，30 天内都可以恢复；它在这面墙抽屉里的摆放也会一起清掉。')),
      [{ label: '放进回收站', value: 'del', cls: 'primary' }, { label: '先留着', value: 'keep' }],
      { dismissValue: 'keep' },
    );
    if (v !== 'del') return;
    const res = await deleteWork(id, doc);
    if (!res.ok) return;
    works = works.filter(w => w.id !== id);
    artCache.delete(id);
    toast('已移入回收站，30 天内可恢复');
    void refreshRecycle();
    renderPanel(); renderWallContent();
  }

  /** 未完成的创作：从存档快照重建关卡，直接续拼 */
  async function resumeDraft(s: CkptSummary) {
    const cp = await loadCheckpoint(s.levelId);
    if (!cp || !cp.def) { toast('这份进度找不到了，重新上传同一张图也能继续'); return; }
    const d = cp.def;
    const def: LevelDef = {
      id: 0, key: d.key, name: d.name, mode: 'custom',
      w: d.w, h: d.h, colors: [...d.colors],
      target: Int16Array.from(d.target), beads: Int16Array.from(d.beads),
      wrongCount: 0, capacity: 24, timeLimit: 0, objectives: [], difficulty: '轻松',
      elements: { ice: [], star: [], fog: [], lock: null, bombs: [] },
    };
    def.wrongCount = [...def.target].filter((t, i) => t >= 0 && def.beads[i] !== t).length;
    if (!host.play) { toast('请从游戏主页进入后再试'); return; }
    host.play(def);
  }

  async function dropDraft(s: CkptSummary) {
    const v = await dialog(
      h('div', {}, h('h2', {}, `放弃《${s.name ?? '我的创作'}》的进度？`), h('p.hint', {}, `已拼 ${Math.round(s.progress * 100)}%，放弃后就从头再来啦。`)),
      [{ label: '放弃进度', value: 'del', cls: 'primary' }, { label: '先留着', value: 'keep' }],
      { dismissValue: 'keep' },
    );
    if (v !== 'del') return;
    clearCheckpoint(s.levelId);
    toast('已放弃这份进度');
    renderPanel();
  }

  async function refreshRecycle() {
    recycle = await listRecycle();
    if (!disposed && panel === 'works') renderPanel();
  }

  async function restoreFromRecycle(r: RecycleEntry) {
    const ok = await restoreWork(r.id);
    if (!ok) { toast('恢复失败，请稍后再试'); return; }
    toast(`《${r.name}》已回到「我的创作」`);
    const data = await loadStudio();
    works = data.works;
    doc = data.doc;
    wall = doc.walls.find(w => w.id === doc.activeWallId) ?? doc.walls[0];
    void refreshRecycle();
    renderPanel();
  }

  /* ---------- 多墙管理 ---------- */

  function switchWall(id: string) {
    doc.activeWallId = id;
    wall = doc.walls.find(w => w.id === id) ?? null;
    selection = null;
    view = { x: -80, y: -60, scale: 0.85 };
    applyView(); renderTabs(); renderWallContent(); renderInspector(); renderPanel(); scheduleSave();
  }

  async function addWall() {
    const input = h('input.studio-input', { maxlength: 20, value: '', placeholder: '给新墙起个名字，比如「粉色梦幻」' }) as HTMLInputElement;
    const v = await dialog(h('div', {}, h('h2', {}, '新建作品墙'), h('p.hint', {}, '每面墙的墙纸、贴纸和摆放都相互独立，同一幅画可以贴上多面墙。'), input), [{ label: '创建', value: 'ok', cls: 'primary' }, { label: '取消', value: 'no' }]);
    if (v !== 'ok') return;
    const w = emptyWall(input.value.trim() || `墙 ${doc.walls.length + 1}`);
    doc.walls.push(w);
    switchWall(w.id);
  }

  async function renameWall(w: WallDef) {
    const input = h('input.studio-input', { maxlength: 20, value: w.name }) as HTMLInputElement;
    const v = await dialog(h('div', {}, h('h2', {}, '重命名作品墙'), input), [{ label: '保存', value: 'ok', cls: 'primary' }, { label: '取消', value: 'no' }]);
    if (v !== 'ok') return;
    w.name = input.value.trim().slice(0, 20) || w.name;
    renderTabs(); scheduleSave();
  }

  async function manageWall() {
    const w = activeWall();
    const v = await dialog(h('div', {}, h('h2', {}, w.name),
      h('p.hint', {}, `${w.items.filter(i => i.onWall).length} 件作品 · ${w.stickers.length} 个贴纸 · 墙纸「${WALLPAPERS.find(x => x.id === w.wallpaper)?.name}」`)),
      [{ label: '重命名', value: 'rename' }, { label: '删除这面墙', value: 'del' }, { label: '关闭', value: 'close' }]);
    if (v === 'rename') return void renameWall(w);
    if (v === 'del') {
      if (doc.walls.length <= 1) { toast('至少要保留一面墙哦'); return; }
      const c = await dialog(h('div', {}, h('h2', {}, `删除「${w.name}」？`), h('p.hint', {}, '墙上的摆放和贴纸会一起删除；作品本身保留在抽屉里。')), [{ label: '删除', value: 'yes', cls: 'primary' }, { label: '先留着', value: 'no' }]);
      if (c !== 'yes') return;
      doc.walls = doc.walls.filter(x => x.id !== w.id);
      switchWall(doc.walls[0].id);
    }
  }

  /* ---------- 指针交互：平移 / 缩放 / 拖动 / 旋转 / 捏合 ---------- */

  type P = { x: number; y: number };
  const pointers = new Map<number, P>();
  let mode: 'idle' | 'pan' | 'pinch-view' | 'drag' | 'rotate' | 'pinch-item' = 'idle';
  let dragTarget: Selection = null;
  let dragStartWorld: P = { x: 0, y: 0 };
  let dragItemStart: P = { x: 0, y: 0 };
  let pinchStartDist = 0, pinchStartScale = 1, pinchItemStartSize = 0;
  let rotateCenter: P = { x: 0, y: 0 };
  let rotateStartAngle = 0, rotateStartRotation = 0;

  const toWorld = (sx: number, sy: number): P => {
    const r = canvasEl.getBoundingClientRect();
    return { x: (sx - r.left - view.x) / view.scale, y: (sy - r.top - view.y) / view.scale };
  };
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

  canvasEl.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary && pointers.size >= 2) return;
    canvasEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const target = e.target as HTMLElement;
    if (mode === 'idle' && pointers.size === 1) {
      const rotHandle = target.closest<HTMLElement>('[data-rotate]');
      if (rotHandle && selection?.type === 'item') {
        const item = selection.item;
        const el = world.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.workId)}"]`);
        const r = el!.getBoundingClientRect();
        rotateCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        rotateStartAngle = Math.atan2(e.clientY - rotateCenter.y, e.clientX - rotateCenter.x) * 180 / Math.PI;
        rotateStartRotation = item.rotation;
        mode = 'rotate';
        return;
      }
      const itemEl = target.closest<HTMLElement>('[data-item]');
      const stEl = target.closest<HTMLElement>('[data-sticker]');
      if (itemEl) {
        const w = activeWall();
        const item = w.items.find(i => i.workId === itemEl.dataset.item);
        if (item) {
          selection = { type: 'item', item };
          item.z = bumpZ();
          renderWallContent(); renderInspector();
          mode = 'drag';
          dragTarget = selection;
          dragStartWorld = toWorld(e.clientX, e.clientY);
          dragItemStart = { x: item.x, y: item.y };
        }
        return;
      }
      if (stEl) {
        const w = activeWall();
        const s = w.stickers.find(x => x.id === stEl.dataset.sticker);
        if (s) {
          selection = { type: 'sticker', sticker: s };
          s.z = bumpZ();
          renderWallContent(); renderInspector();
          mode = 'drag';
          dragTarget = selection;
          dragStartWorld = toWorld(e.clientX, e.clientY);
          dragItemStart = { x: s.x, y: s.y };
        }
        return;
      }
      mode = 'pan';
      return;
    }
    // 第二根手指
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = dist(a, b);
      if (mode === 'drag' && dragTarget) {
        mode = 'pinch-item';
        pinchItemStartSize = dragTarget.type === 'item' ? dragTarget.item.size : Math.round(dragTarget.sticker.scale * 100);
      } else {
        mode = 'pinch-view';
        pinchStartScale = view.scale;
      }
    }
  });

  canvasEl.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = dist(a, b);
      if (mode === 'pinch-view' && pinchStartDist > 0) {
        view.scale = Math.max(VIEW_MIN, Math.min(VIEW_MAX, pinchStartScale * d / pinchStartDist));
        applyView();
      } else if (mode === 'pinch-item' && dragTarget && pinchStartDist > 0) {
        const ratio = d / pinchStartDist;
        if (dragTarget.type === 'item') dragTarget.item.size = Math.max(90, Math.min(900, Math.round(pinchItemStartSize * ratio)));
        else dragTarget.sticker.scale = Math.max(0.4, Math.min(6, pinchItemStartSize * ratio / 100));
        renderWallContent();
      }
      return;
    }
    if (mode === 'pan') {
      view.x += e.clientX - prev.x;
      view.y += e.clientY - prev.y;
      applyView();
    } else if (mode === 'drag' && dragTarget) {
      const now = toWorld(e.clientX, e.clientY);
      const dx = now.x - dragStartWorld.x, dy = now.y - dragStartWorld.y;
      if (dragTarget.type === 'item') { dragTarget.item.x = Math.round(dragItemStart.x + dx); dragTarget.item.y = Math.round(dragItemStart.y + dy); }
      else { dragTarget.sticker.x = Math.round(dragItemStart.x + dx); dragTarget.sticker.y = Math.round(dragItemStart.y + dy); }
      renderWallContent();
    } else if (mode === 'rotate' && selection?.type === 'item') {
      const angle = Math.atan2(e.clientY - rotateCenter.y, e.clientX - rotateCenter.x) * 180 / Math.PI;
      selection.item.rotation = Math.round(rotateStartRotation + (angle - rotateStartAngle));
      renderWallContent();
    }
  });

  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (mode === 'drag' || mode === 'rotate' || mode === 'pinch-item') scheduleSave();
      mode = 'idle';
      dragTarget = null;
    } else if (pointers.size === 1 && mode === 'pinch-item') {
      mode = 'drag'; // 从捏合退回拖动
    } else if (pointers.size === 1 && mode === 'pinch-view') {
      mode = 'pan';
    }
  };
  canvasEl.addEventListener('pointerup', endPointer);
  canvasEl.addEventListener('pointercancel', endPointer);

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvasEl.getBoundingClientRect();
    zoomAt(view.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  canvasEl.addEventListener('pointerdown', (e) => {
    // 点空白处取消选中
    if (e.target === canvasEl || (e.target as HTMLElement).classList?.contains('studio-empty-hint')) {
      if (selection) { selection = null; renderWallContent(); renderInspector(); }
    }
  }, true);

  /* ---------- 布局：正常模式(大抽屉+画布预览,点击进全屏) / 全屏模式(大画布+可收起侧栏) ---------- */

  let fullscreen = false;
  let sidebarOpen = true;

  function applyLayout() {
    shell.classList.toggle('fs', fullscreen);
    sidebarEl.classList.toggle('closed', fullscreen && !sidebarOpen);
    if (fullscreen) zoomToFit();
    else { view = { x: -60, y: -50, scale: 0.55 }; applyView(); }
    fullscreenBtn.textContent = fullscreen ? '🗋 退出全屏' : '⛶ 全屏编辑';
    previewTitle.textContent = ` · ${activeWall().name}`;
  }

  const fullscreenBtn = h('button.btn', { title: '全屏编辑：画布占满窗口，素材移到右侧栏', onclick: () => { fullscreen = !fullscreen; applyLayout(); } }, '⛶ 全屏编辑') as HTMLButtonElement;
  const sidebarToggle = h('button.studio-sidebar-toggle', { title: sidebarOpen ? '收起侧栏' : '展开侧栏', onclick: () => { sidebarOpen = !sidebarOpen; applyLayout(); } }, '⟩') as HTMLButtonElement;
  const previewTitle = h('span.studio-preview-title', {}, '');
  const canvasHint = h('button.studio-canvas-hint', { title: '进入全屏编辑', onclick: () => { fullscreen = true; applyLayout(); } },
    h('span.icon', {}, '⛶'),
    h('span.t', {}, '全屏编辑'),
    h('small', {}, '画布可平移缩放 · 双指捏合'));
  const previewBar = h('div.studio-preview-bar', {},
    h('span.studio-preview-label', {}, '🖼 墙面预览', previewTitle),
    h('button.studio-preview-fs', { onclick: () => { fullscreen = true; applyLayout(); } }, '⛶ 全屏编辑'));
  const previewWrap = h('div.studio-preview', {}, previewBar, canvasEl, canvasHint,
    h('div.studio-preview-foot', {}, '💡 点右上角按钮进入全屏，可平移缩放整面墙、摆放作品与贴纸'));

  const shell = h('div.studio-screen2', {},
    h('header.studio-header2', {},
      h('button.btn', { onclick: host.toMap }, '← 返回地图'),
      h('div.studio-brand', {}, h('div.studio-eyebrow', {}, 'MY LITTLE STUDIO'), h('b', {}, '我的小画室')),
      h('div.studio-header-actions', {},
        fullscreen && h('button.icon-btn.small', { title: '适应内容：缩小到看到全部作品', onclick: () => zoomToFit() }, '⌖'),
        fullscreen && h('button.icon-btn.small.studio-zoom-btn', { title: '缩小画布', onclick: () => zoomAt(view.scale / 1.25, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2) }, '−'),
        fullscreen && h('span.studio-zoom', {}, zoomLabel),
        fullscreen && h('button.icon-btn.small.studio-zoom-btn', { title: '放大画布', onclick: () => zoomAt(view.scale * 1.25, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2) }, '＋'),
        fullscreenBtn,
        h('button.btn.primary', { onclick: host.create }, '✨ 拼一幅新的'))),
    tabsEl,
    h('div.studio-main', {}, previewWrap, inspectorEl, sidebarToggle, sidebarEl),
    status);
  root.replaceChildren(shell);

  async function load() {
    try {
      const data = await loadStudio();
      if (disposed) return;
      works = data.works;
      doc = data.doc;
      wall = doc.walls.find(w => w.id === doc.activeWallId) ?? doc.walls[0];
      doc.activeWallId = wall.id;
      applyLayout(); renderTabs(); renderWallContent(); renderInspector(); renderPanel();
      void refreshRecycle();
      void refreshCheckpointSummaries().then(changed => { if (changed && !disposed) renderPanel(); });
      status.textContent = '已就绪 ✿ 点画布进入全屏编辑；下方抽屉挑选作品、贴纸和墙纸';
    } catch (e) {
      if (disposed) return;
      status.textContent = e instanceof Error ? `打不开小画室：${e.message}` : '打不开小画室，请重试';
    }
  }
  void load();

  return () => {
    disposed = true;
    clearTimeout(saveTimer);
    if (studioCached()) void saveStudioDoc(doc);
  };
}
