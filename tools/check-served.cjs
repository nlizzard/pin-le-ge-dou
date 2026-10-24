(async () => {
  const html = await fetch('http://localhost:3000/').then(r => r.text());
  const m = html.match(/assets\/index-[^"']+\.js/g) || [];
  console.log('served html 引用:', m);
  const fs = require('fs');
  console.log('dist 实际文件:', fs.readdirSync('dist/assets').filter(f => f.endsWith('.js')));
  if (m[0]) {
    const js = await fetch('http://localhost:3000/' + m[0]).then(r => r.text());
    console.log('served js 含戴珍珠?', js.includes('戴珍珠耳环的少女'));
  }
})();
