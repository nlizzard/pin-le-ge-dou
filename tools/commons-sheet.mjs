// 把 levels/commons-*.json 渲染成一张带编号的拼贴图，供人工挑选。
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const levels = path.join(root, '..', 'levels');
const CELL = 130, LABEL = 22, COLS = 8;
const files = (await import('node:fs')).readdirSync(levels).filter((f) => /^commons-.*\.json$/.test(f)).sort();

const items = [];
for (const f of files) {
  const p = JSON.parse(await readFile(path.join(levels, f), 'utf8'));
  const rows = p.rows.length, w = Math.max(...p.rows.map((r) => r.length));
  const buf = Buffer.alloc(w * 6 * rows * 6 * 4);
  p.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const c = p.palette[ch] ?? '#000000';
    for (let k = 0; k < 3; k++) buf[((y * 6) * w * 6 + x * 6) * 4 + [0, 1, 2][k]] = parseInt(c.slice(1 + k * 2, 3 + k * 2), 16);
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      const o = (((y * 6 + dy) * w * 6) + (x * 6 + dx)) * 4;
      buf[o] = parseInt(c.slice(1, 3), 16); buf[o + 1] = parseInt(c.slice(3, 5), 16); buf[o + 2] = parseInt(c.slice(5, 7), 16); buf[o + 3] = 255;
    }
  }));
  const png = await sharp(buf, { raw: { width: w * 6, height: rows * 6, channels: 4 } }).png().toBuffer();
  items.push({ file: f.replace('.json', ''), png });
}

const rows = Math.ceil(items.length / COLS);
const composites = items.map((it, i) => {
  const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * (CELL + LABEL);
  const label = Buffer.from(`<svg width="${CELL}" height="${LABEL}"><rect width="100%" height="100%" fill="#3d3566"/><text x="4" y="16" font-size="14" fill="#fff" font-family="sans-serif">${i + 1}. ${it.file.slice(8, 26)}</text></svg>`);
  return [
    { input: it.png, left: cx + Math.floor((CELL - 110) / 2), top: cy + 2, fit: 'contain' },
    { input: label, left: cx, top: cy + CELL - 18 },
  ];
}).flat();

await sharp({ create: { width: COLS * CELL, height: rows * (CELL + LABEL), channels: 4, background: '#ffffff' } })
  .composite(composites)
  .png()
  .toFile(path.join(root, '..', 'art', 'commons-sheet.png'));
console.log(`共 ${items.length} 个候选 → art/commons-sheet.png（编号 1-${items.length}）`);
console.log(items.map((it, i) => `${i + 1}=${it.file}`).join('\n'));
