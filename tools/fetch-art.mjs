#!/usr/bin/env node
/**
 * 从开源素材库抓取卡通图片，自动像素化成候选关卡，生成预览页供人工挑选。
 *
 * 数据来源：Openverse（https://openverse.org，WordPress 基金会运营的开放素材搜索），
 * 只取 CC0（公共领域贡献）和 PDM（公有领域）许可的图片，可以自由使用、无需署名。
 * 每张图的来源和许可证都会记录下来。
 *
 * 用法：
 *   node tools/fetch-art.mjs "cartoon cat" "cute food" "landscape illustration" [选项]
 *   node tools/fetch-art.mjs --from art/urls.txt        # 自己整理的地址清单
 *
 * 选项：
 *   --count 8        每个关键词取几张（默认 8）
 *   --size 24        像素化最长边格子数
 *   --colors 8       颜色数
 *   --from 文件      地址清单：每行「图片地址 | 标题 | 作者 | 许可证 | 来源页面」，只有地址是必填
 *
 * 结果在 art/candidates/ 下：每张图一个 .json + .png 预览，以及 art/preview.html 总览。
 * 挑好以后运行：node tools/approve-art.mjs <key1> <key2> ...  把它们放进 levels/，成为新关卡。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadInput, pixelize, preview, slug, writePattern } from './pixelize.mjs';

const API = 'https://api.openverse.org/v1/images/';
const OUT = path.join('art', 'candidates');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

async function search(q, count) {
  const url = `${API}?q=${encodeURIComponent(q)}&license=cc0,pdm&page_size=${Math.min(50, count * 3)}&mature=false`;
  const res = await fetch(url, { headers: { 'user-agent': 'picture-play-fetch-art/1.0 (personal game)' } });
  if (!res.ok) throw new Error(`搜索失败 ${res.status}（${q}）`);
  const body = await res.json();
  // 偏好 png / svg（通常是插画、透明背景），其次 jpg
  const items = (body.results ?? []).filter((r) => r.url && /cc0|pdm/i.test(r.license ?? ''));
  const score = (r) => (/\.(png|svg)(\?|$)/i.test(r.url) || r.filetype === 'png' || r.filetype === 'svg' ? 0 : 1);
  items.sort((a, b) => score(a) - score(b));
  return items.map((r) => ({
    url: r.url,
    title: r.title || q,
    author: r.creator || '未知',
    license: `${(r.license || '').toUpperCase()}${r.license_version ? ' ' + r.license_version : ''}`,
    page: r.foreign_landing_url || r.url,
    query: q,
  }));
}

async function fromList(file) {
  const text = await readFile(file, 'utf8');
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [url, title, author, license, page] = l.split('|').map((s) => s?.trim());
      return { url, title: title || path.basename(url), author: author || '未知', license: license || '请自行确认', page: page || url, query: 'list' };
    });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = +(args.count || 8);
  const size = +(args.size || 24);
  const colors = +(args.colors || 8);
  let items = [];
  if (args.from) items = await fromList(args.from);
  else {
    if (!args._.length) {
      console.log('用法：node tools/fetch-art.mjs "cartoon cat" "cute food" [--count 8] [--size 24] [--colors 8]\n   或：node tools/fetch-art.mjs --from art/urls.txt');
      process.exit(1);
    }
    for (const q of args._) {
      try {
        const found = await search(q, count);
        console.log(`🔎 ${q}：找到 ${found.length} 张 CC0/公有领域图片`);
        items.push(...found.slice(0, count * 2).map((x) => ({ ...x, want: count })));
      } catch (e) {
        console.error(`✗ ${e.message}`);
      }
    }
  }
  await mkdir(OUT, { recursive: true });
  const done = [];
  const perQuery = new Map();
  for (const it of items) {
    const n = perQuery.get(it.query) ?? 0;
    if (it.want && n >= it.want) continue;
    const key = slug(`${it.query}-${it.title}`).slice(0, 40) + '-' + Math.abs(hash(it.url)).toString(36).slice(0, 4);
    try {
      const buf = await loadInput(it.url);
      const pattern = await pixelize(buf, { size, colors, key, name: shortName(it.title) });
      const file = path.join(OUT, `${key}.json`);
      await writePattern(pattern, file, { url: it.page, image: it.url, title: it.title, author: it.author, license: it.license });
      await preview(pattern, file.replace(/\.json$/, '.png'));
      await writeFile(path.join(OUT, `${key}.orig${extOf(it.url)}`), buf);
      done.push({ ...it, key, rows: pattern.rows.length, cols: Math.max(...pattern.rows.map((r) => r.length)), colors: Object.keys(pattern.palette).length });
      perQuery.set(it.query, n + 1);
      console.log(`  ✓ ${key}`);
    } catch (e) {
      console.log(`  - 跳过 ${it.title}：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // 别对素材站太频繁
  }
  // 预览页
  const html = `<!doctype html><meta charset="utf-8"><title>候选关卡预览</title>
<style>body{font-family:system-ui,'Microsoft YaHei';background:#dcdcf5;margin:20px}h1{color:#8f6ff0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.c{background:#fff;border-radius:14px;padding:12px}.c img{max-width:110px;max-height:110px;image-rendering:pixelated;vertical-align:middle;margin:4px}code{background:#f3f0ff;padding:2px 6px;border-radius:6px;user-select:all}small{color:#777}</style>
<h1>候选关卡（${done.length}）</h1><p>挑满意的，运行 <code>node tools/approve-art.mjs key1 key2 …</code> 加进游戏。不满意的可以调 --size / --colors 重新生成。</p>
<div class="grid">${done
    .map(
      (d) => `<div class="c"><img src="candidates/${d.key}.orig${extOf(d.url)}"><img src="candidates/${d.key}.png"><br>
<b>${esc(shortName(d.title))}</b> <small>${d.cols}×${d.rows} · ${d.colors} 色</small><br><code>${d.key}</code><br>
<small>作者：${esc(d.author)} · ${esc(d.license)} · <a href="${esc(d.page)}" target="_blank">来源</a></small></div>`,
    )
    .join('\n')}</div>`;
  await writeFile(path.join('art', 'preview.html'), html);
  console.log(`\n完成：${done.length} 个候选。打开 art/preview.html 挑选，然后运行 node tools/approve-art.mjs <key...>`);
}

function extOf(u) {
  try {
    return path.extname(/^https?:/.test(u) ? new URL(u).pathname : u) || '.img';
  } catch {
    return '.img';
  }
}

function shortName(t) {
  return String(t)
    .replace(/\.(png|jpe?g|svg|gif)$/i, '')
    .replace(/[_-]+/g, ' ')
    .slice(0, 16)
    .trim();
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h;
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
