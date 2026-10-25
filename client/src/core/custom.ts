import { countWrong, scramble, type LevelDef, type PatternGrid } from './level';
import { mulberry32 } from './rng';

type RGB = [number, number, number];
export const MIN_CUSTOM_SIZE = 16;
export const MAX_CUSTOM_SIZE = 256;
export function validateCustomSize(size: number): number {
  if (!Number.isInteger(size) || size < MIN_CUSTOM_SIZE || size > MAX_CUSTOM_SIZE) {
    throw new Error(`最长边格子数请输入 ${MIN_CUSTOM_SIZE}–${MAX_CUSTOM_SIZE} 之间的整数`);
  }
  return size;
}
/** 按原图大小推荐拼豆格子数（最长边，8 的倍数）：大图自动给更多格子，避免糊成一团 */
export function smartCustomSize(w: number, h: number): number {
  const area = Math.sqrt(Math.max(1, w * h));
  return Math.max(24, Math.min(160, Math.round(area / 22 / 8) * 8));
}
const distance = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
/** 小尺寸图片的确定性 k-means 量化。透明区域不进入调色板。 */
export function quantizeImage(data: Uint8ClampedArray, w: number, h: number, maxColors: number): PatternGrid {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_CUSTOM_SIZE || h > MAX_CUSTOM_SIZE || data.length !== w * h * 4) throw new Error('图片尺寸无效');
  const pixels: RGB[] = [], cells: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const alpha = data[i * 4 + 3] / 255;
    if (alpha < .25) continue;
    pixels.push([0, 1, 2].map(c => Math.round(data[i * 4 + c] * alpha + 255 * (1 - alpha))) as RGB);
    cells.push(i);
  }
  if (pixels.length < 4) throw new Error('图片可见区域太小，请换一张图片');
  const k = Math.max(2, Math.min(24, Math.round(maxColors) || 12));
  const centers: RGB[] = [pixels[0]];
  // 最远点初始化，使小面积的对比色也有机会保留。
  while (centers.length < k) {
    let far = 0, best = -1;
    pixels.forEach((p, i) => { const d = Math.min(...centers.map(c => distance(p, c))); if (d > best) { best = d; far = i; } });
    if (best < 64) break;
    centers.push(pixels[far]);
  }
  const labels = new Int16Array(pixels.length);
  for (let pass = 0; pass < 12; pass++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, i) => {
      let best = 0, bestDistance = Infinity;
      centers.forEach((c, j) => {
        const d = distance(p, c);
        if (d < bestDistance) { bestDistance = d; best = j; }
      });
      labels[i] = best;
      p.forEach((v, c) => sums[best][c] += v); sums[best][3]++;
    });
    sums.forEach((s, j) => { if (s[3]) centers[j] = s.slice(0, 3).map(v => Math.round(v / s[3])) as RGB; });
  }
  const target = new Int16Array(w * h).fill(-1), colors: string[] = [], remap = new Map<string, number>();
  cells.forEach((cell, i) => {
    const hex = '#' + centers[labels[i]].map(v => v.toString(16).padStart(2, '0')).join('');
    if (!remap.has(hex)) { remap.set(hex, colors.length); colors.push(hex); }
    target[cell] = remap.get(hex)!;
  });
  if (colors.length < 2) throw new Error('图片只有一种颜色，无法打乱；试试颜色更丰富的图片');
  return { w, h, target, colors };
}

export function buildCustomLevel(grid: PatternGrid, name: string, seed = Date.now()): LevelDef {
  let hash = 2166136261;
  const identity = `${grid.w},${grid.h};${grid.colors.join(',')};${Array.from(grid.target).join(',')}`;
  for (const ch of identity) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const beads = scramble(grid.target, .75, mulberry32(seed), grid.w, grid.h);
  if (!countWrong(grid.target, beads)) {
    const a = grid.target.findIndex(c => c >= 0);
    const b = grid.target.findIndex(c => c >= 0 && c !== grid.target[a]);
    if (a < 0 || b < 0) throw new Error('需要至少两种颜色才能创建关卡');
    [beads[a], beads[b]] = [beads[b], beads[a]];
  }
  return { ...grid, target: Int16Array.from(grid.target), beads, id: 0, key: `custom-${(hash >>> 0).toString(16)}`,
    name: name.trim().slice(0, 24) || '我的小小作品', mode: 'custom', wrongCount: countWrong(grid.target, beads),
    capacity: 24, timeLimit: 0, objectives: [], difficulty: '轻松', elements: { ice: [], star: [], fog: [], lock: null, bombs: [] } };
}

export async function readCustomImage(file: File, size: number, colors: number): Promise<PatternGrid> {
  validateCustomSize(size);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 15 * 1024 * 1024) throw new Error('图片请小于 15 MB');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await img.decode().catch(() => { throw new Error('图片无法读取，请换一张试试'); });
    if (img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，请缩小后再试');
    const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return quantizeImage(ctx.getImageData(0, 0, w, h).data, w, h, colors);
  } finally { URL.revokeObjectURL(url); }
}
