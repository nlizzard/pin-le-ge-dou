/** 预渲染贴图：连续底色 + 圆角金字塔方豆。 */
export const SPRITE = 96;
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex: string, amt: number): string {
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${hexToRgb(hex).map(f).join(',')})`;
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  return c;
}
export function makeTile(hex: string): HTMLCanvasElement {
  const c = canvas(), ctx = c.getContext('2d')!;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}
export function makeBead(hex: string): HTMLCanvasElement {
  const c = canvas(), ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(35,25,45,.25)';
  ctx.beginPath(); ctx.roundRect(13, 17, 70, 72, 19); ctx.fill();
  ctx.fillStyle = shade(hex, -.3);
  ctx.beginPath(); ctx.roundRect(12, 11, 72, 72, 19); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(15, 12, 66, 65, 16); ctx.clip();
  ctx.fillStyle = hex; ctx.fillRect(15, 12, 66, 65);
  const faces = [
    { points: [15,12,81,12,48,44], light: .35 },
    { points: [81,12,81,77,48,44], light: -.08 },
    { points: [81,77,15,77,48,44], light: -.22 },
    { points: [15,77,15,12,48,44], light: .12 },
  ];
  for (const {points: p, light} of faces) {
    ctx.fillStyle = shade(hex, light); ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(16, 13, 64, 63, 16); ctx.stroke();
  // 深色描边：让错位的浮起豆和归位的平坦豆一眼区分
  ctx.strokeStyle = 'rgba(38,26,58,.62)'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.roundRect(13.75, 12.75, 68.5, 68.5, 18); ctx.stroke();
  return c;
}
/** 归位豆：平铺满格、只留极淡的菱形缝线，完成区域连成一片（参考图：平坦 + 隐约缝线纹理） */
export function makeSettled(hex: string): HTMLCanvasElement {
  const c = canvas(), ctx = c.getContext('2d')!;
  ctx.fillStyle = hex; ctx.fillRect(0, 0, SPRITE, SPRITE);
  const faces = [
    { points: [0,0,96,0,48,48], light: .08 },
    { points: [96,0,96,96,48,48], light: -.02 },
    { points: [96,96,0,96,48,48], light: -.07 },
    { points: [0,96,0,0,48,48], light: .03 },
  ];
  for (const {points: p, light} of faces) {
    ctx.fillStyle = shade(hex, light); ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.closePath(); ctx.fill();
  }
  return c;
}
export function makeSocket(): HTMLCanvasElement {
  const c = canvas(), ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(30,20,60,.12)';
  ctx.beginPath(); ctx.roundRect(22, 22, 52, 52, 14); ctx.fill();
  return c;
}
export interface SpriteSet { tiles: HTMLCanvasElement[]; beads: HTMLCanvasElement[]; settled: HTMLCanvasElement[]; socket: HTMLCanvasElement }
export function buildSprites(colors: string[]): SpriteSet {
  return { tiles: colors.map(makeTile), beads: colors.map(makeBead), settled: colors.map(makeSettled), socket: makeSocket() };
}
export const SYMBOLS = ['●', '▲', '■', '★', '◆', '♥', '✚', '◐', '♣', '☾', '✿', '⬣'];

/* ---------- 相近色拉开（Lab 色距，缓解玩家眼疲劳） ---------- */

function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb([L, A, B]: [number, number, number]): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
  const fi = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = fi(fx) * 0.95047, y = fi(fy), z = fi(fz) * 1.08883;
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const G = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const Bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  const gam = (c: number) => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };
  return [gam(R), gam(G), gam(Bl)];
}
const labDist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * 把调色板里两两太接近的颜色确定性推开（Lab 距离 ≥ minDist），
 * 色相/明暗关系基本保留，只是不再难以分辨。
 */
export function separateColors(colors: string[], minDist = 20): string[] {
  const labs = colors.map((c) => rgbToLab(hexToRgb(c)));
  const out = [...colors];
  for (let i = 1; i < out.length; i++) {
    for (let pass = 0; pass < 16; pass++) {
      let worst = Infinity, wj = 0;
      for (let j = 0; j < i; j++) {
        const d = labDist(labs[j], labs[i]);
        if (d < worst) { worst = d; wj = j; }
      }
      if (worst >= minDist) break;
      const [L0, A0, B0] = labs[wj];
      let dL = labs[i][0] - L0, dA = labs[i][1] - A0, dB = labs[i][2] - B0;
      if (Math.hypot(dL, dA, dB) < 0.5) { dL = L0 < 55 ? 1 : -1; dA = 0.3; dB = -0.3; }
      const scale = (minDist + 3) / Math.hypot(dL, dA, dB);
      const L = Math.max(10, Math.min(94, L0 + dL * scale));
      const A = Math.max(-75, Math.min(75, A0 + dA * scale));
      const B = Math.max(-75, Math.min(75, B0 + dB * scale));
      labs[i] = [L, A, B];
      out[i] = `#${labToRgb(labs[i]).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return out;
}
