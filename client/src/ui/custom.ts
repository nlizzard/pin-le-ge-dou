import { buildCustomLevel, readCustomImage, validateCustomSize, MIN_CUSTOM_SIZE, MAX_CUSTOM_SIZE } from '../core/custom';
import type { LevelDef, PatternGrid } from '../core/level';
import { drawArtwork } from '../render/artwork';
import { dialog, h } from './dom';

export async function openCustomStudio(onPlay: (level: LevelDef) => void, onWall: () => void, returnLabel = '返回地图') {
  let grid: PatternGrid | null = null, file: File | null = null, revision = 0;
  const preview = h('canvas.custom-preview', { 'aria-label': '转换后的拼豆图预览' }) as HTMLCanvasElement;
  preview.width = preview.height = 480;
  const status = h('p.studio-status', { role: 'status' }, '选一张喜欢的照片，让它变成专属拼豆图。');
  const name = h('input.studio-input', { maxlength: 24, value: '我的小小作品', 'aria-label': '作品名称' }) as HTMLInputElement;
  const size = h('select.studio-input', { 'aria-label': '精细度' }, ...[24, 32, 48, 64, 96, 128].map((n, i) => h('option', { value: n, selected: n === 32 }, `${n} 格 · ${['轻松拼', '刚刚好', '细节控', '更精致', '大幅创作', '超细画布'][i]}`)), h('option', { value: 'custom' }, '自定义格子数')) as HTMLSelectElement;
  const customSize = h('input.studio-input', { type: 'number', min: MIN_CUSTOM_SIZE, max: MAX_CUSTOM_SIZE, step: 1, value: 80, inputmode: 'numeric', 'aria-label': '最长边格子数', 'aria-describedby': 'custom-size-hint' }) as HTMLInputElement;
  const customField = h('label.studio-label', { hidden: true }, '最长边格子数', customSize);
  const sizeHint = h('p.hint#custom-size-hint', {}, `按最长边计算，另一边保持原图比例。自定义支持 ${MIN_CUSTOM_SIZE}–${MAX_CUSTOM_SIZE} 格；格子越多越精细，可放大画布慢慢拼。`);
  const palette = h('select.studio-input', { 'aria-label': '颜色数量' }, ...[8, 12, 16, 24].map(n => h('option', { value: n, selected: n === 12 }, `${n} 色`))) as HTMLSelectElement;
  const start = h('button.btn.primary.big', { disabled: true }, '打乱，开始拼豆') as HTMLButtonElement;
  const upload = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '上传自定义图片' }) as HTMLInputElement;
  const rebuild = async () => {
    const version = ++revision;
    start.disabled = true; grid = null; status.textContent = '正在为你调色…';
    try {
      const selectedSize = validateCustomSize(size.value === 'custom' ? customSize.valueAsNumber : +size.value);
      customSize.removeAttribute('aria-invalid');
      if (!file) { status.textContent = '选一张喜欢的照片，让它变成专属拼豆图。'; return; }
      // 先让状态文字绘制出来，再转换较大的图片。
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (version !== revision) return;
      const result = await readCustomImage(file, selectedSize, +palette.value);
      if (version !== revision) return;
      grid = result;
      const ctx = preview.getContext('2d')!; ctx.clearRect(0, 0, 480, 480);
      drawArtwork(ctx, grid, 16, 16, 448, 448);
      status.textContent = `${grid.w} × ${grid.h} 格 · ${grid.colors.length} 种颜色 · 随时暂停，慢慢拼`;
      start.disabled = false;
    } catch (e) {
      if (version !== revision) return;
      if (size.value === 'custom' && (!customSize.validity.valid || !customSize.value)) customSize.setAttribute('aria-invalid', 'true');
      preview.getContext('2d')!.clearRect(0, 0, 480, 480);
      status.textContent = e instanceof Error ? e.message : '转换失败，请重新选择图片';
    }
  };
  upload.onchange = () => { file = upload.files?.[0] ?? null; if (file) { name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 24); void rebuild(); } };
  size.onchange = () => { customField.hidden = size.value !== 'custom'; void rebuild(); };
  customSize.oninput = palette.onchange = () => void rebuild();
  const body = h('div.custom-studio', {}, h('div.studio-eyebrow', {}, 'YOUR LITTLE ART STUDIO'), h('h2', {}, '把喜欢，拼成一幅画'),
    h('p.hint', {}, '不限时 · 全部道具免费畅用 · 完成后制作分享卡'),
    h('label.upload-zone', {}, h('span', {}, '＋ 选择你的图片'), upload, h('small', {}, 'JPG / PNG / WebP，最大 15 MB · 图片仅在本机处理')),
    h('div.studio-fields', {}, h('label', {}, '精细度', size), h('label', {}, '调色板', palette)), customField, sizeHint, preview, status,
    h('label.studio-label', {}, '给作品起个名字', name), start,
    h('button.btn.studio-wall-link', { onclick: () => { (body.closest('.overlay')!.querySelector('.dialog-buttons button') as HTMLButtonElement).click(); onWall(); } }, '🎀 回我的小画室'));
  // 自定义按钮只关闭当前弹窗，避免影响稍后打开的游戏弹窗。
  const done = dialog(body, [{ label: returnLabel, value: 'back' }], { cls: 'studio-dialog' });
  const overlay = body.closest('.overlay')!;
  start.onclick = () => {
    if (!grid || start.disabled) return;
    const level = buildCustomLevel(grid, name.value);
    (overlay.querySelector('.dialog-buttons button') as HTMLButtonElement).click();
    onPlay(level);
  };
  await done; revision++;
}
