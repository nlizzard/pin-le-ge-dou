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
  return c;
}
export function makeSocket(): HTMLCanvasElement {
  const c = canvas(), ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(30,20,60,.12)';
  ctx.beginPath(); ctx.roundRect(22, 22, 52, 52, 14); ctx.fill();
  return c;
}
export interface SpriteSet { tiles: HTMLCanvasElement[]; beads: HTMLCanvasElement[]; socket: HTMLCanvasElement }
export function buildSprites(colors: string[]): SpriteSet {
  return { tiles: colors.map(makeTile), beads: colors.map(makeBead), socket: makeSocket() };
}
export const SYMBOLS = ['●', '▲', '■', '★', '◆', '♥', '✚', '◐', '♣', '☾', '✿', '⬣'];
