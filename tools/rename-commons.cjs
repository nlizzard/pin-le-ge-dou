// 给精选的 Commons 图案起中文名（来源与许可证已记录在 source / credits.json）
const fs = require('fs');
const path = require('path');
const names = {
  'commons-1665-girl-with-a-pearl-earring-i9ck6': '戴珍珠耳环的少女',
  'commons-commanderx16-icon-rainbow-o4': '彩虹箭标',
  'commons-evil-pixel-art-face-300x300-p7': '红脸小怪',
  'commons-fido-character-from-don-t-buy-th-uh': '黄色小怪兽',
  'commons-horse-animation-cartoon-video-ga-64vot': '小马漫步',
  'commons-horse-animation-cartoon-video-ga-chabg': '小马回眸',
  'commons-long-neck-dino-long-neck-brachio-xzbt1': '紫色长颈龙',
  'commons-long-neck-left-side-angled-long--8fxdi': '粉红长颈龙',
  'commons-obstacle-1-blue-neon-retro-anima-jt0m6': '霓虹三角',
  'commons-pixel-hearts-barnstar-ib': '爱心勋章',
  'commons-red-heart-illustration-j6': '红色爱心',
  'commons-t-rex-tyrannosaurus-animation-vi-5r2oe': '小霸王龙',
  'commons-t-rex-tyrannosaurus-animation-vi-i0reg': '霸王龙宝宝',
};
const dir = 'levels';
let n = 0;
for (const [key, name] of Object.entries(names)) {
  const f = path.join(dir, key + '.json');
  if (!fs.existsSync(f)) { console.log('缺文件:', key); continue; }
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  p.name = name;
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
  n++;
}
// credits.json 只保留现存文件
const creditsFile = path.join(dir, 'credits.json');
let credits = [];
try { credits = JSON.parse(fs.readFileSync(creditsFile, 'utf8')); } catch { /* 无 */ }
const existing = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
credits = credits.filter(c => existing.has(c.key));
for (const f of fs.readdirSync(dir).filter(f => /^commons-.*\.json$/.test(f))) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (p.source && !credits.some(c => c.key === p.key)) credits.push({ key: p.key, name: p.name, ...p.source });
}
fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2) + '\n');
console.log('重命名', n, '个；credits 保留', credits.length, '条');
