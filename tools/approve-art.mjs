#!/usr/bin/env node
/**
 * 把挑好的候选关卡（art/candidates/<key>.json）放进 levels/，成为游戏里的新关卡。
 * 用法：node tools/approve-art.mjs <key1> [key2 ...] [--name key=新名字]
 * 也可以直接手动把 json 复制到 levels/，再修改里面的 name。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writePattern } from './pixelize.mjs';

const args = process.argv.slice(2);
const renames = new Map();
const keys = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name') {
    const [k, ...v] = (args[++i] ?? '').split('=');
    renames.set(k, v.join('='));
  } else keys.push(args[i]);
}
if (!keys.length) {
  console.log('用法：node tools/approve-art.mjs <key1> [key2 ...] [--name key=中文名]');
  process.exit(1);
}
for (const key of keys) {
  const src = path.join('art', 'candidates', `${key}.json`);
  try {
    const p = JSON.parse(await readFile(src, 'utf8'));
    if (renames.has(key)) p.name = renames.get(key);
    const { source, ...pattern } = p;
    await writePattern(pattern, path.join('levels', `${key}.json`), source);
    console.log(`✓ ${key} → levels/${key}.json（${p.name}）`);
  } catch (e) {
    console.error(`✗ ${key}：${e.message}`);
  }
}
console.log('刷新游戏页面即可在关卡地图末尾看到新关卡。');
