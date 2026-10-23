/** 预渲染的格子底色与豆子贴图（固定分辨率，绘制时缩放） */
export const SPRITE = 96;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** amt > 0 变亮，< 0 变暗 */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function canvas(size = SPRITE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 底色方块：带一点斜面高光，像截图里的宝石方块 */
export function makeTile(hex: string): HTMLCanvasElement {
  const c = canvas();
  const ctx = c.getContext('2d')!;
  const S = SPRITE;
  const p = S * 0.04;
  roundRect(ctx, p, p, S - 2 * p, S - 2 * p, S * 0.16);
  ctx.fillStyle = shade(hex, -0.18);
  ctx.fill();
  roundRect(ctx, p, p, S - 2 * p, S - 2 * p - S * 0.05, S * 0.16);
  ctx.fillStyle = hex;
  ctx.fill();
  // 四角斜面，模仿方块的十字刻面
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(p * 2, p * 2);
  ctx.lineTo(S / 2, S / 2);
  ctx.lineTo(S - p * 2, p * 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(p * 2, S - p * 3);
  ctx.lineTo(S / 2, S / 2);
  ctx.lineTo(S - p * 2, S - p * 3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // 细描边，浅色方块也看得清
  roundRect(ctx, p, p, S - 2 * p, S - 2 * p, S * 0.16);
  ctx.lineWidth = S * 0.025;
  ctx.strokeStyle = 'rgba(40,20,80,0.18)';
  ctx.stroke();
  return c;
}

/** 拼豆：带孔的圆环，有高光 */
export function makeBead(hex: string): HTMLCanvasElement {
  const c = canvas();
  const ctx = c.getContext('2d')!;
  const S = SPRITE;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.3;
  // 阴影
  ctx.beginPath();
  ctx.arc(cx, cy + S * 0.03, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();
  // 主体
  const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  g.addColorStop(0, shade(hex, 0.35));
  g.addColorStop(0.6, hex);
  g.addColorStop(1, shade(hex, -0.2));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = S * 0.025;
  ctx.strokeStyle = shade(hex, -0.3);
  ctx.stroke();
  // 中间的孔
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = shade(hex, -0.38);
  ctx.fill();
  // 高光
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, Math.PI * 1.1, Math.PI * 1.45);
  ctx.lineWidth = S * 0.06;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.stroke();
  return c;
}

/** 空位凹槽 */
export function makeSocket(): HTMLCanvasElement {
  const c = canvas();
  const ctx = c.getContext('2d')!;
  const S = SPRITE;
  const g = ctx.createRadialGradient(S / 2, S / 2 - S * 0.05, S * 0.05, S / 2, S / 2, S * 0.34);
  g.addColorStop(0, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  return c;
}

export interface SpriteSet {
  tiles: HTMLCanvasElement[];
  beads: HTMLCanvasElement[];
  socket: HTMLCanvasElement;
}

export function buildSprites(colors: string[]): SpriteSet {
  return { tiles: colors.map(makeTile), beads: colors.map(makeBead), socket: makeSocket() };
}

/** 色弱模式用的符号 */
export const SYMBOLS = ['●', '▲', '■', '★', '◆', '♥', '✚', '◐', '♣', '☾', '✿', '⬣'];
