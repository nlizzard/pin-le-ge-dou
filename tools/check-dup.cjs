const fs = require('fs');
const src = fs.readFileSync('client/src/core/generatedPatterns.ts', 'utf8');
const start = src.indexOf('= [', src.indexOf('export const GENERATED_PATTERNS')) + 2;
const end = src.lastIndexOf('];');
const json = JSON.parse(src.slice(start, end + 1));
const byRows = new Map();
for (const p of json) {
  const k = p.rows.join('\n');
  byRows.set(k, (byRows.get(k) || 0) + 1);
}
const dup = [...byRows.entries()].filter(([, n]) => n > 1);
console.log('生成图案:', json.length, '| 独特形状:', byRows.size, '| 重复形状组:', dup.length, '| 最大重复:', Math.max(...byRows.values()));
