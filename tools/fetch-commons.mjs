// 从 Wikimedia Commons 抓取 CC0/公有领域 的拼豆作品与像素画，转成关卡写入 levels/。
// 与 fetch-art.mjs（Openverse，需要 API key）互补；Commons 无需鉴权，可按许可过滤。
// 每张图的来源与许可证写进关卡 JSON 和 levels/credits.json，可自由使用。
//
// 用法：yarn node tools/fetch-commons.mjs "perler beads" "pixel art" ... [--each 8] [--size 24] [--colors 8]
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadInput, pixelize, writePattern, slug } from './pixelize.mjs';

const args = process.argv.slice(2);
const FLAGS = ['each', 'size', 'colors'];
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const QUERIES = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (FLAGS.includes(args[i].slice(2))) i++;
    continue;
  }
  QUERIES.push(args[i]);
}
const EACH = +(flag('each', 8) || 8);
const SIZE = +(flag('size', 24) || 24);
const COLORS = +(flag('colors', 8) || 8);

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = { 'user-agent': 'picture-play-fetch-commons/1.0 (personal game)' };

async function search(q) {
  const url = `${API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Csize&iiurlwidth=640`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`搜索失败 ${res.status}（${q}）`);
  const body = await res.json();
  const pages = Object.values(body.query?.pages ?? {});
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const lic = String(ii.extmetadata?.LicenseShortName?.value ?? '');
    if (!/CC0|public domain/i.test(lic)) continue; // 只要 CC0 / 公有领域
    if (!/image\/(jpe?g|png|svg\+xml)/i.test(ii.mime ?? '')) continue;
    if ((ii.width ?? 0) < 200 || (ii.height ?? 0) < 200) continue;
    const artist = String(ii.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim();
    out.push({
      url: ii.thumburl || ii.url,
      title: (p.title ?? '').replace(/^File:/, '').replace(/\.(png|jpe?g|svg|gif|tiff?)$/i, ''),
      author: artist || '未知',
      license: lic,
      page: ii.descriptionurl ?? ii.url,
      query: q,
    });
  }
  return out;
}

function cleanName(t) {
  return String(t).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12) || '拼豆图案';
}

// ---- 现有图案的剪影集合（手绘 + 生成 + levels/*.json），用于去重 ----
const server = await createServer({ root: process.cwd(), logLevel: 'error', appType: 'custom', server: { middlewareMode: true }, optimizeDeps: { disabled: true } });
let existingShapes;
try {
  const { PATTERNS } = await server.ssrLoadModule('/client/src/core/patterns.ts');
  existingShapes = new Set(PATTERNS.map((p) => p.rows.join('\n')));
  console.log(`现有图案 ${PATTERNS.length} 张，剪影去重就绪`);
} finally {
  await server.close();
}

const seenTitles = new Set();
const found = [];
for (const q of (QUERIES.length ? QUERIES : ['perler beads', 'hama beads', 'fuse beads', 'pixel art'])) {
  try {
    const rows = await search(q);
    console.log(`🔎 ${q}：${rows.length} 张 CC0/PD`);
    for (const r of rows) {
      const key = r.title.toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      found.push(r);
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
  }
}

await mkdir('art', { recursive: true });
const approved = [];
let idx = 0;
for (const it of found) {
  if (approved.length >= EACH * QUERIES.length) break;
  // key 用标题+作者+来源页的哈希，避免同系列不同图互相覆盖
  let h = 0;
  for (const c of `${it.title}|${it.author}|${it.page}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const key = 'commons-' + slug(it.title).slice(0, 32) + '-' + Math.abs(h).toString(36).slice(0, 5);
  try {
    const buf = await loadInput(it.url);
    const pattern = await pixelize(buf, { size: SIZE, colors: COLORS, key, name: cleanName(it.title) });
    const rows = pattern.rows.length, cols = Math.max(...pattern.rows.map((r) => r.length));
    const colors = Object.keys(pattern.palette).length;
    const inside = pattern.rows.join('').split('').filter((c) => c !== '.').length;
    const aspect = rows / cols;
    const sig = pattern.rows.join('\n');
    if (colors < 4) throw new Error(`只有 ${colors} 色`);
    if (inside < 50) throw new Error(`有效格子太少(${inside})`);
    if (aspect < 0.45 || aspect > 2.2) throw new Error(`比例太极端(${rows}x${cols})`);
    if (existingShapes.has(sig)) throw new Error('与现有关卡剪影重复');
    existingShapes.add(sig);
    await writePattern(pattern, path.join('levels', `${key}.json`), { url: it.page, image: it.url, title: it.title, author: it.author, license: it.license });
    approved.push({ key, name: pattern.name, rows, cols, colors });
    console.log(`  ✓ ${key}（${it.title} · ${it.license}）→ ${cols}×${rows} ${colors}色`);
  } catch (e) {
    console.log(`  - 跳过 ${it.title}：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
await writeFile(path.join('art', 'commons-fetch-log.json'), JSON.stringify(approved, null, 2));
console.log(`\n完成：本次新增 ${approved.length} 个关卡 → levels/commons-*.json（记得跑 npm run build:levels）`);
