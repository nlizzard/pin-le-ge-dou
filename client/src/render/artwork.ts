import type { PatternGrid } from '../core/level';
/** 整图用同一套平涂色块，像素边缘保持清晰。 */
export function drawArtwork(ctx: CanvasRenderingContext2D, grid: PatternGrid, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / grid.w, height / grid.h);
  const ox = x + (width - grid.w * scale) / 2, oy = y + (height - grid.h * scale) / 2;
  grid.target.forEach((c, i) => {
    if (c < 0) return;
    const left = Math.round(ox + (i % grid.w) * scale), top = Math.round(oy + Math.floor(i / grid.w) * scale);
    ctx.fillStyle = grid.colors[c];
    ctx.fillRect(left, top, Math.round(ox + (i % grid.w + 1) * scale) - left, Math.round(oy + (Math.floor(i / grid.w) + 1) * scale) - top);
  });
}
