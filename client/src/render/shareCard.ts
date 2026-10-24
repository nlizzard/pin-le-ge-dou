import type { LevelDef } from '../core/level';
import { drawArtwork } from './artwork';

export const CARD_STYLES = [
  { id: 'cream', name: '奶油手帐', sub: '把小确幸收进相册', bg: '#f6eedf', ink: '#665344', accent: '#b68a62', paper: '#fffdf7' },
  { id: 'cherry', name: '樱桃蝴蝶结', sub: '今天的可爱由我负责', bg: '#fbe8ed', ink: '#913951', accent: '#d35c7d', paper: '#fff9f8' },
  { id: 'garden', name: '薄荷花园', sub: '在自己的花园里慢慢开花', bg: '#e6efe3', ink: '#466453', accent: '#7c9b75', paper: '#fcfcf0' },
  { id: 'night', name: '午夜星光', sub: '把闪闪发光的自己收藏', bg: '#252740', ink: '#f4e9d5', accent: '#c7adf0', paper: '#f4effa' },
] as const;
export type CardStyle = typeof CARD_STYLES[number]['id'];
export interface ShareData { level: LevelDef; seconds: number; propsUsed: number }
export interface CardOptions { style: CardStyle; ratio: '3:4' | '9:16'; quote: string; source: string }
export function defaultCardOptions(): CardOptions {
  return { style: 'cream', ratio: '3:4', quote: '把生活调成喜欢的颜色。', source: '' };
}
const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function flower(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, petal: string) {
  ctx.fillStyle = petal;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * size * .48, y + Math.sin(a) * size * .48, size * .38, size * .23, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#e9b95c'; ctx.beginPath(); ctx.arc(x, y, size * .22, 0, Math.PI * 2); ctx.fill();
}
function bow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = s * .08; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(side * s * 1.1, -s, side * s * 1.1, s * .6, 0, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(side * s * .1, s * .5, side * s * .55, s * .75); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, s * .1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath(); ctx.moveTo(x, y-s); ctx.quadraticCurveTo(x+s*.15, y-s*.15, x+s, y); ctx.quadraticCurveTo(x+s*.15,y+s*.15,x,y+s); ctx.quadraticCurveTo(x-s*.15,y+s*.15,x-s,y); ctx.quadraticCurveTo(x-s*.15,y-s*.15,x,y-s); ctx.fill();
}
function wrapped(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const lines: string[] = []; let line = '';
  for (const c of text.replace(/\s+/g, ' ').trim()) {
    if (ctx.measureText(line + c).width > width && line) { lines.push(line); line = ''; }
    line += c;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
  return lines;
}
export function renderShareCard(canvas: HTMLCanvasElement, data: ShareData, options: CardOptions) {
  const theme = CARD_STYLES.find(s => s.id === options.style)!;
  const W = 1080, H = options.ratio === '9:16' ? 1920 : 1440;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);
  // 四款各有自己的底纹与装饰语言。
  if (theme.id === 'cherry') {
    ctx.fillStyle = '#ffffff55';
    for (let x = 0; x < W; x += 84) ctx.fillRect(x, 0, 38, H);
    for (let y = 0; y < H; y += 84) ctx.fillRect(0, y, W, 38);
  } else if (theme.id === 'cream') {
    ctx.strokeStyle = '#d9cbb455'; ctx.lineWidth = 1;
    for (let y = 25; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (theme.id === 'garden') {
    for (let y = 45; y < H; y += 145) for (let x = 38; x < W; x += 152) flower(ctx, x + (y % 2) * 24, y, 18, '#ffffffaa');
  } else {
    for (let i = 0; i < 75; i++) { ctx.fillStyle = i % 3 ? '#ffffff66' : '#e9d5a8'; sparkle(ctx, (i * 173 + 29) % W, (i * 263 + 31) % H, i % 4 === 0 ? 10 : 3); }
  }
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.textAlign = 'center'; ctx.fillStyle = theme.ink;
  ctx.font = `500 22px ${font}`; ctx.fillText('P I C T U R E   P L A Y   /   拼 豆 归 位', W/2, 112);
  ctx.font = `600 64px ${font}`; ctx.fillText(['慢慢拼，也会发光','可爱，是亲手拼出来的','给生活种一点颜色','收集一小片星光'][CARD_STYLES.indexOf(theme)], W/2, 214);
  ctx.font = `24px ${font}`; ctx.fillText(theme.sub, W/2, 266);
  const frameY = H === 1920 ? 435 : 315, frameH = 760;
  ctx.save(); ctx.shadowColor = theme.id === 'night' ? '#00000055' : '#59423926'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = theme.paper; ctx.beginPath(); ctx.roundRect(108, frameY, 864, frameH, theme.id === 'garden' ? 100 : 8); ctx.fill(); ctx.restore();
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.setLineDash([5, 9]);
  ctx.strokeRect(132, frameY + 24, 816, frameH - 48); ctx.setLineDash([]);
  drawArtwork(ctx, data.level, 172, frameY + 58, 736, 600);
  ctx.fillStyle = theme.id === 'night' ? '#53416e' : theme.ink;
  ctx.font = `500 26px ${font}`;
  const title = wrapped(ctx, data.level.name, 660, 1)[0] || '我的小小作品';
  ctx.fillText(title, W/2, frameY + 710);
  if (theme.id === 'cherry') { bow(ctx, W/2, frameY + 4, 72, theme.accent); bow(ctx, 920, frameY+frameH-5, 42, theme.accent); }
  else if (theme.id === 'garden') { flower(ctx, 131, frameY+60, 65, '#fffdf5'); flower(ctx, 939, frameY+frameH-70, 60, '#fffdf5'); }
  else if (theme.id === 'night') { ctx.fillStyle = '#d7bb79'; sparkle(ctx, 148, frameY+14, 50); sparkle(ctx, 946, frameY+frameH-20, 44); }
  else {
    ctx.save(); ctx.translate(190, frameY+5); ctx.rotate(-.15); ctx.fillStyle = '#d9b483aa'; ctx.fillRect(-98,-22,196,44); ctx.restore();
    ctx.save(); ctx.translate(892, frameY+frameH-8); ctx.rotate(-.15); ctx.fillStyle = '#d9b483aa'; ctx.fillRect(-98,-22,196,44); ctx.restore();
  }
  const quoteY = frameY + frameH + (H === 1920 ? 140 : 62);
  ctx.fillStyle = theme.ink; ctx.font = `500 31px ${font}`;
  wrapped(ctx, options.quote, 800, 3).forEach((line, i) => ctx.fillText(line, W/2, quoteY + i * 47));
  ctx.font = `20px ${font}`;
  if (options.source) ctx.fillText(wrapped(ctx, options.source, 820, 1)[0] ?? '', W/2, quoteY + 145);
  const footer = H - 100;
  ctx.font = `23px ${font}`;
  ctx.fillText(`${data.level.mode === 'custom' ? '自由创作' : '闯关作品'}   /   ${duration(data.seconds)}   /   ${data.level.w} × ${data.level.h}   /   ${data.propsUsed ? '道具助力' : '纯手作'}`, W/2, footer);
  ctx.globalAlpha = .7; ctx.font = `18px ${font}`; ctx.fillText('MADE OF LITTLE MOMENTS  ·  一颗一颗，把喜欢归位', W/2, footer + 45); ctx.globalAlpha = 1;
}

