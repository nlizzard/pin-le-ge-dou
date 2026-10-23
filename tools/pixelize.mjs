#!/usr/bin/env node
/**
 * 把一张图片转换成关卡图案 JSON（levels/*.json）。
 *
 * 用法：
 *   node tools/pixelize.mjs <图片路径或网址> [选项]
 *
 * 选项：
 *   --size 24          图案最长边的格子数（默认 24，建议 16–36）
 *   --colors 8         颜色数（默认 8，建议 4–12）
 *   --name 小猫        关卡名（默认用文件名）
 *   --key cat          唯一标识（默认由名字生成）
 *   --bg auto          背景处理：auto=透明区域 + 与四角颜色相近且连通边缘的区域视为画布外；none=保留整张图
 *   --out levels/x.json 输出路径（默认 levels/<key>.json）
 *   --source-url / --author / --license / --title   素材来源信息（写进 JSON，并汇总到 levels/credits.json）
 *   --preview          额外输出同名 .png 预览图
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function dist2(a, b) {
  // 加权 RGB 距离，更接近人眼感受
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/** 确定性的 k-means（k-means++ 初始化，固定种子） */
function kmeans(pixels, k, iters = 20) {
  if (pixels.length <= k) return { centers: pixels.map((p) => [...p]), labels: pixels.map((_, i) => i) };
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const centers = [pixels[Math.floor(rand() * pixels.length)].slice()];
  const d = new Float64Array(pixels.length).fill(Infinity);
  while (centers.length < k) {
    let sum = 0;
    const last = centers[centers.length - 1];
    for (let i = 0; i < pixels.length; i++) {
      d[i] = Math.min(d[i], dist2(pixels[i], last));
      sum += d[i];
    }
    if (sum === 0) break;
    let r = rand() * sum;
    let idx = 0;
    for (; idx < pixels.length - 1; idx++) {
      r -= d[idx];
      if (r <= 0) break;
    }
    centers.push(pixels[idx].slice());
  }
  const labels = new Int32Array(pixels.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = dist2(pixels[i], centers[c]);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      }
      labels[i] = best;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const a = acc[labels[i]];
      a[0] += pixels[i][0];
      a[1] += pixels[i][1];
      a[2] += pixels[i][2];
      a[3]++;
    }
    acc.forEach((a, c) => a[3] && (centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]));
  }
  return { centers, labels: Array.from(labels) };
}

/**
 * 核心转换：图片 buffer → 图案对象 { key, name, palette, rows }
 */
export async function pixelize(input, opts = {}) {
  const sharp = (await import('sharp')).default;
  const size = opts.size ?? 24;
  const nColors = opts.colors ?? 8;
  const bgMode = opts.bg ?? 'auto';

  // 先裁掉透明边，按 4 倍分辨率取样：先在高分辨率下量化颜色，再按 4×4 块投票，细节更清晰
  const S = 4;
  const img = sharp(input).ensureAlpha().trim({ threshold: 10 });
  const { data, info } = await img
    .resize(size * S, size * S, { fit: 'inside', kernel: 'mitchell' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const px = [];
  for (let i = 0; i < W * H; i++) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]);

  // 背景：透明像素一定是画布外；auto 模式下与四角颜色相近、且和边缘连通的区域也是画布外
  const outside = new Uint8Array(W * H);
  px.forEach((p, i) => p[3] < 128 && (outside[i] = 1));
  const hasAlpha = outside.some((v) => v);
  if (bgMode === 'auto' && !hasAlpha) {
    const corners = [0, W - 1, (H - 1) * W, H * W - 1].map((i) => px[i]);
    const bg = [0, 1, 2].map((c) => corners.reduce((a, p) => a + p[c], 0) / 4);
    const near = (i) => dist2(px[i], bg) < 9 * 45 * 45;
    const q = [];
    for (let x = 0; x < W; x++) q.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) q.push(y * W, y * W + W - 1);
    while (q.length) {
      const i = q.pop();
      if (outside[i] || !near(i)) continue;
      outside[i] = 1;
      const x = i % W;
      if (x > 0) q.push(i - 1);
      if (x < W - 1) q.push(i + 1);
      if (i >= W) q.push(i - W);
      if (i < (H - 1) * W) q.push(i + W);
    }
  }

  const insideIdx = [];
  for (let i = 0; i < W * H; i++) if (!outside[i]) insideIdx.push(i);
  if (insideIdx.length < 20 * S * S) throw new Error('图里几乎没有内容（可能整张都被当成了背景，试试 --bg none）');
  // 抽样做 k-means，再给所有像素分配最近的颜色
  const step = Math.max(1, Math.floor(insideIdx.length / 6000));
  const sample = insideIdx.filter((_, k) => k % step === 0).map((i) => px[i].slice(0, 3));
  const { centers } = kmeans(sample, nColors);
  const label = new Int16Array(W * H).fill(-1);
  for (const i of insideIdx) {
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const dd = dist2(px[i], centers[c]);
      if (dd < bd) {
        bd = dd;
        best = c;
      }
    }
    label[i] = best;
  }
  // 按 S×S 块投票：超过一半是画布外就算画布外，否则取出现最多的颜色
  const w = Math.ceil(W / S);
  const h = Math.ceil(H / S);
  const grid = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const votes = new Map();
      let out = 0;
      let n = 0;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const X = x * S + dx;
          const Y = y * S + dy;
          if (X >= W || Y >= H) continue;
          n++;
          const l = label[Y * W + X];
          if (l < 0) out++;
          else votes.set(l, (votes.get(l) ?? 0) + 1);
        }
      }
      if (out * 2 >= n) continue;
      let best = -1;
      let bv = 0;
      for (const [l, v] of votes) if (v > bv) {
        bv = v;
        best = l;
      }
      grid[y * w + x] = best;
    }
  }

  // 去杂点：四周邻居都是同一种别的颜色的单个像素，改成邻居的颜色
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < w * h; i++) {
      if (grid[i] < 0) continue;
      const x = i % w;
      const nb = [x > 0 ? grid[i - 1] : -2, x < w - 1 ? grid[i + 1] : -2, i >= w ? grid[i - w] : -2, i < (h - 1) * w ? grid[i + w] : -2].filter((v) => v >= 0);
      if (nb.length >= 3 && nb.every((v) => v === nb[0]) && nb[0] !== grid[i]) grid[i] = nb[0];
    }
  }

  // 只保留实际用到的颜色，按使用量从多到少分配字符
  const counts = new Map();
  grid.forEach((c) => c >= 0 && counts.set(c, (counts.get(c) ?? 0) + 1));
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  if (used.length < 3) throw new Error(`只得到 ${used.length} 种颜色，太单调了，试试更大的 --colors`);
  const charOf = new Map(used.map((c, k) => [c, CHARS[k]]));
  const palette = Object.fromEntries(used.map((c) => [charOf.get(c), hex(...centers[c])]));

  // 去掉四周全空的行列
  let rows = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += grid[y * w + x] < 0 ? '.' : charOf.get(grid[y * w + x]);
    rows.push(r);
  }
  while (rows.length && /^\.+$/.test(rows[0])) rows.shift();
  while (rows.length && /^\.+$/.test(rows[rows.length - 1])) rows.pop();
  let left = Math.min(...rows.map((r) => r.search(/[^.]/)).filter((v) => v >= 0));
  let right = Math.max(...rows.map((r) => r.length - 1 - [...r].reverse().join('').search(/[^.]/)));
  rows = rows.map((r) => r.slice(left, right + 1).replace(/\.+$/, ''));

  return { key: opts.key, name: opts.name, palette, rows };
}

export function slug(s) {
  const base = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'art-' + Math.random().toString(36).slice(2, 8);
}

export async function loadInput(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { 'user-agent': 'picture-play-pixelize/1.0' } });
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${src}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

/** 渲染预览 png（每格 12 像素） */
export async function preview(pattern, file) {
  const sharp = (await import('sharp')).default;
  const cell = 12;
  const h = pattern.rows.length;
  const w = Math.max(...pattern.rows.map((r) => r.length));
  const buf = Buffer.alloc(w * cell * h * cell * 4);
  pattern.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const c = pattern.palette[ch];
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      for (let dy = 1; dy < cell - 1; dy++)
        for (let dx = 1; dx < cell - 1; dx++) {
          const o = ((y * cell + dy) * w * cell + x * cell + dx) * 4;
          buf[o] = r;
          buf[o + 1] = g;
          buf[o + 2] = b;
          buf[o + 3] = 255;
        }
    }),
  );
  await sharp(buf, { raw: { width: w * cell, height: h * cell, channels: 4 } }).png().toFile(file);
}

/** 写入关卡 JSON，并把来源汇总进 credits.json */
export async function writePattern(pattern, outFile, source) {
  const obj = { ...pattern };
  if (source && (source.url || source.author || source.license)) obj.source = source;
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(obj, null, 2) + '\n');
  if (obj.source && path.basename(path.dirname(path.resolve(outFile))) === 'levels') {
    const creditsFile = path.join(path.dirname(outFile), 'credits.json');
    let credits = [];
    try {
      credits = JSON.parse(await readFile(creditsFile, 'utf8'));
    } catch {
      /* 新建 */
    }
    credits = credits.filter((c) => c.key !== obj.key);
    credits.push({ key: obj.key, name: obj.name, ...obj.source });
    await writeFile(creditsFile, JSON.stringify(credits, null, 2) + '\n');
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = args._[0];
  if (!src) {
    console.log('用法：node tools/pixelize.mjs <图片路径或网址> [--size 24] [--colors 8] [--name 名字] [--key id] [--bg auto|none] [--preview]');
    process.exit(1);
  }
  const name = args.name || path.basename(src).replace(/\.[a-z0-9]+$/i, '');
  const key = args.key || slug(name);
  const pattern = await pixelize(await loadInput(src), { size: +(args.size || 24), colors: +(args.colors || 8), bg: args.bg || 'auto', key, name });
  const out = args.out || path.join('levels', `${key}.json`);
  await writePattern(pattern, out, { url: args['source-url'], author: args.author, license: args.license, title: args.title });
  if (args.preview) await preview(pattern, out.replace(/\.json$/, '.png'));
  console.log(`✓ ${out}  ${pattern.rows.length} 行 × ${Math.max(...pattern.rows.map((r) => r.length))} 列，${Object.keys(pattern.palette).length} 种颜色`);
  console.log(pattern.rows.join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
