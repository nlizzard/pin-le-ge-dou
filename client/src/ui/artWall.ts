import { loadWall, normalizePlacement, saveWallSettings, updateWallWork, wallWorkBounds, WALL_THEMES, workShareData, type WallSettings, type WallWork } from '../artWallStore';
import { renderShareCard } from '../render/shareCard';
import { customRecords } from '../customRecords';
import { fmtTime, h, toast } from './dom';
import { openShareStudio } from './share';

export function renderArtWall(root: HTMLElement, host: { toMap(): void; create(): void }): () => void {
  let disposed = false, loaded = false, works: WallWork[] = [], settings: WallSettings = { title: '我的小画室', theme: 'cream', decor: 'flowers' }, selected: string | null = null;
  let drag: { work: WallWork; pointer: number; x: number; y: number; startX: number; startY: number; before: WallWork['placement'] } | null = null;
  const cards = new Map<string, HTMLElement>(), thumbnails = new Map<string, string>();
  const status = h('p.wall-status', { role: 'status' }, '正在打开你的小画室…');
  const title = h('input.wall-title', { value: settings.title, maxlength: 30, disabled: true, 'aria-label': '小画室名称' }) as HTMLInputElement;
  const board = h('div.art-wall', { 'aria-label': '作品墙，拖动作品自由布置' }) as HTMLDivElement;
  const scroller = h('div.wall-scroll', { tabindex: 0, 'aria-label': '可左右滑动查看整面作品墙' }, board);
  const inspector = h('aside.wall-inspector');
  const shelf = h('div.wall-shelf');
  const themePicker = h('div.wall-themes');
  const decor = h('select.studio-input', { 'aria-label': '墙面装饰', disabled: true }, h('option', { value: 'flowers' }, '小花装饰'), h('option', { value: 'stars' }, '星光装饰'), h('option', { value: 'none' }, '干净墙面')) as HTMLSelectElement;
  const saveLayout = h('button.btn', { disabled: true, onclick: () => void saveAll() }, '保存布置') as HTMLButtonElement;
  const history = h('details.custom-history', {}, h('summary', {}, '我的创作足迹'));
  const refreshHistory = () => {
    const rows = customRecords().slice(0, 5);
    history.replaceChildren(h('summary', {}, '我的创作足迹'), ...rows.map(r => h('p', {}, `${r.name} · ${fmtTime(r.seconds)} · ${r.propsUsed ? '道具助力' : '纯手作'} · ${new Date(r.completedAt).toLocaleDateString()}`)));
    history.hidden = rows.length === 0;
  };
  refreshHistory();
  const shell = h('div.wall-screen', {},
    h('header.wall-header', {}, h('button.btn', { onclick: host.toMap }, '← 返回地图'), h('div', {}, h('div.studio-eyebrow', {}, 'MY LITTLE STUDIO'), title), h('button.btn.primary', { onclick: host.create }, '✨ 拼一幅新的')),
    h('div.wall-toolbar', {}, h('div', {}, h('span.wall-control-label', {}, '挑一面喜欢的墙'), themePicker), h('label.wall-decor-label', {}, '装饰', decor), saveLayout),
    h('p.wall-instructions', {}, '拖动作品自由摆放 · 点选作品换相框、调大小与角度 · 手机可左右滑动墙面'),
    h('div.wall-layout', {}, scroller, inspector),
    h('section.wall-storage', {}, h('h3', {}, '待布置的作品'), shelf, history), status);
  root.replaceChildren(shell);

  function failed(error: unknown) {
    if (disposed) return;
    status.textContent = error instanceof Error ? `尚未保存：${error.message}` : '尚未保存，请点击「保存布置」重试';
  }
  function saved() { if (!disposed) status.textContent = '已保存到本地存档 · 作品、相框和墙面布置会一起留下来'; }
  function persist(work: WallWork) { void updateWallWork(work.id, { placement: { ...work.placement } }).then(saved).catch(failed); }
  async function saveAll() {
    try { await Promise.all([saveWallSettings({ ...settings }), ...works.map(w => updateWallWork(w.id, { placement: { ...w.placement } }))]); saved(); } catch (e) { failed(e); }
  }
  function applySettings() {
    board.dataset.theme = settings.theme; board.dataset.decor = settings.decor;
    title.value = settings.title; decor.value = settings.decor;
    themePicker.querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)));
  }
  for (const t of WALL_THEMES) {
    themePicker.append(h('button.wall-theme', { 'data-theme': t.id, 'aria-label': t.name, 'aria-pressed': String(t.id === settings.theme), title: t.name, style: { '--wall-swatch': t.color }, onclick: () => {
      if (!loaded) return;
      settings.theme = t.id; applySettings(); void saveWallSettings({ ...settings }).then(saved).catch(failed);
    } }, h('span'), t.name));
  }
  title.onchange = () => { settings.title = title.value.trim() || '我的小画室'; applySettings(); void saveWallSettings({ ...settings }).then(saved).catch(failed); };
  decor.onchange = () => { settings.decor = decor.value as WallSettings['decor']; applySettings(); void saveWallSettings({ ...settings }).then(saved).catch(failed); };

  function thumbnail(work: WallWork): string {
    const full = document.createElement('canvas'); renderShareCard(full, workShareData(work), work.options);
    const small = document.createElement('canvas'); small.width = 324; small.height = full.height * .3;
    small.getContext('2d')!.drawImage(full, 0, 0, small.width, small.height);
    return small.toDataURL('image/jpeg', .9);
  }
  function place(work: WallWork) {
    const card = cards.get(work.id); if (!card) return;
    const p = work.placement;
    const { width, height, marginX, marginY, rangeX, rangeY } = wallWorkBounds(board.clientWidth, board.clientHeight, p, work.options.ratio);
    card.style.width = `${width}px`; card.style.height = `${height}px`;
    card.style.left = `${marginX + p.x * rangeX}px`;
    card.style.top = `${marginY + p.y * rangeY}px`;
    card.style.transform = `rotate(${p.rotation}deg)`; card.style.zIndex = String(p.z);
    card.classList.toggle('selected', selected === work.id);
    card.setAttribute('aria-pressed', String(selected === work.id));
  }
  function select(work: WallWork, bringForward = false) {
    selected = work.id;
    if (bringForward) { work.placement.z = Math.max(0, ...works.map(w => w.placement.z)) + 1; persist(work); }
    works.forEach(place); renderInspector();
  }
  function renderInspector() {
    const work = works.find(w => w.id === selected);
    const picker = h('select.studio-input', { 'aria-label': '选择作品' }, h('option', { value: '' }, '选择墙上的作品'), ...works.filter(w => w.placement.onWall).map(w => h('option', { value: w.id }, w.name))) as HTMLSelectElement;
    picker.value = selected ?? '';
    picker.onchange = () => { const chosen = works.find(w => w.id === picker.value); if (chosen) select(chosen, true); };
    if (!work) {
      inspector.replaceChildren(picker, h('div.studio-eyebrow', {}, 'CURATED BY YOU'), h('h2', {}, '把喜欢挂起来'), h('p', {}, '每幅亲手拼好的画，都值得拥有自己的位置。'), h('p.hint', {}, works.length ? '点选一幅作品，开始布置。' : '完成自由创作后，作品会自动收藏到这里。'), h('button.btn.primary', { onclick: host.create }, '去创作一幅'));
      return;
    }
    const size = h('input', { type: 'range', min: 12, max: 32, value: work.placement.size, 'aria-label': '作品大小' }) as HTMLInputElement;
    const rotation = h('input', { type: 'range', min: -12, max: 12, step: 1, value: work.placement.rotation, 'aria-label': '作品角度' }) as HTMLInputElement;
    size.oninput = () => { work.placement.size = +size.value; place(work); };
    rotation.oninput = () => { work.placement.rotation = +rotation.value; place(work); };
    size.onchange = rotation.onchange = () => persist(work);
    inspector.replaceChildren(picker, h('div.studio-eyebrow', {}, 'A LITTLE MASTERPIECE'), h('h2', {}, work.name), h('p.hint', {}, `${work.grid.w} × ${work.grid.h} 格 · ${new Date(work.completedAt).toLocaleDateString()}`),
      h('button.btn.primary.wall-edit-frame', { onclick: async () => {
        await openShareStudio(workShareData(work), { initial: work.options, backLabel: '返回小画室', saveLabel: '保存相框到小画室', onSave: async options => {
          await updateWallWork(work.id, { options }); work.options = { ...options };
          thumbnails.set(work.id, thumbnail(work));
          const img = cards.get(work.id)?.querySelector('img'); if (img) img.src = thumbnails.get(work.id)!;
          place(work); saved();
        } });
      } }, '✧ 修改相框 / 文案 / 下载'),
      h('label.wall-range-label', {}, '作品大小', size), h('label.wall-range-label', {}, '摆放角度', rotation),
      h('button.btn', { onclick: () => { work.placement.rotation = 0; place(work); persist(work); renderInspector(); } }, '把画摆正'),
      h('button.btn', { onclick: () => {
        work.placement.onWall = false; persist(work); selected = null; renderWorks();
      } }, '暂时收起这幅作品'),
      h('p.hint', {}, '相框可随时重新修改。收起的作品会放进下方的待布置区。'));
  }
  function renderWorks() {
    cards.clear(); board.replaceChildren(); shelf.replaceChildren();
    for (const work of works) {
      const image = h('img', { src: thumbnails.get(work.id), alt: work.name, draggable: false });
      if (work.placement.onWall) {
        const card = h('div.wall-work', { role: 'button', tabindex: 0, 'data-work': work.id, 'aria-label': `作品：${work.name}，可拖动摆放，方向键微调位置` }, image);
        cards.set(work.id, card); board.append(card); place(work);
      } else {
        shelf.append(h('button.wall-shelf-item', { onclick: () => { work.placement.onWall = true; persist(work); selected = work.id; renderWorks(); } }, image, h('span', {}, work.name), h('small', {}, '＋ 放到墙上')));
      }
    }
    if (!works.some(w => w.placement.onWall)) board.append(h('div.wall-empty', {}, h('span', {}, '✧'), h('h2', {}, '这里，等着你的第一幅画'), h('p', {}, works.length ? '从下方挑一幅作品放上来吧' : '把亲手完成的小美好，一幅幅收藏起来'), h('button.btn', { onclick: host.create }, '开始创作')));
    if (!shelf.childElementCount) shelf.append(h('p.hint', {}, '收起的作品会在这里等你，随时可以重新上墙。'));
    renderInspector();
  }
  const workAt = (target: EventTarget | null) => target instanceof Element ? works.find(w => w.id === target.closest<HTMLElement>('[data-work]')?.dataset.work) : undefined;
  board.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || drag) return;
    const work = workAt(e.target); if (!work) return;
    select(work);
    const before = { ...work.placement };
    work.placement.z = Math.max(0, ...works.map(w => w.placement.z)) + 1;
    drag = { work, pointer: e.pointerId, x: e.clientX, y: e.clientY, startX: work.placement.x, startY: work.placement.y, before };
    board.setPointerCapture(e.pointerId); place(work);
  });
  board.addEventListener('pointermove', e => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { rangeX, rangeY } = wallWorkBounds(board.clientWidth, board.clientHeight, drag.work.placement, drag.work.options.ratio);
    drag.work.placement.x = drag.startX + (e.clientX - drag.x) / rangeX;
    drag.work.placement.y = drag.startY + (e.clientY - drag.y) / rangeY;
    drag.work.placement = normalizePlacement(drag.work.placement); place(drag.work);
  });
  function endDrag(e: PointerEvent, cancelled = false) {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { work, before } = drag; drag = null;
    if (cancelled) { work.placement = before; place(work); } else persist(work);
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
  }
  board.addEventListener('pointerup', e => endDrag(e));
  board.addEventListener('pointercancel', e => endDrag(e, true));
  board.addEventListener('lostpointercapture', e => endDrag(e, true));
  board.addEventListener('keydown', e => {
    const work = workAt(e.target); if (!work) return;
    if (['Enter', ' '].includes(e.key)) { e.preventDefault(); select(work, true); return; }
    const delta = e.shiftKey ? .05 : .01;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    const d = directions[e.key]; if (!d) return;
    e.preventDefault(); work.placement = normalizePlacement({ ...work.placement, x: work.placement.x + d[0], y: work.placement.y + d[1] });
    select(work); persist(work);
  });
  const observer = new ResizeObserver(() => works.forEach(place)); observer.observe(board);
  applySettings(); renderInspector();
  async function load() {
    try {
      const result = await loadWall(); if (disposed) return;
      works = result.works; settings = result.settings;
      for (let i = 0; i < works.length; i++) {
        if (disposed) return;
        thumbnails.set(works[i].id, thumbnail(works[i]));
        if (i % 4 === 3) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (disposed) return;
      loaded = true; title.disabled = decor.disabled = saveLayout.disabled = false;
      applySettings(); renderWorks(); refreshHistory(); saved();
    } catch (e) { failed(e); board.replaceChildren(h('div.wall-empty', {}, h('h2', {}, '暂时打不开小画室'), h('p', {}, '本地存档服务还没连上，稍后再试试。'), h('button.btn', { onclick: () => void load() }, '重试'))); }
  }
  void load();
  return () => { disposed = true; observer.disconnect(); drag = null; };
}
