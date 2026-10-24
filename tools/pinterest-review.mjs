import sharp from 'sharp';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const root=process.argv[2]||'art/pinterest-board';await mkdir(`${root}/review`,{recursive:true});
const assets=JSON.parse(await readFile(`${root}/assets.json`,'utf8')).filter(a=>a.status==='downloaded');
for(let page=0;page<Math.ceil(assets.length/42);page++){
 const subset=assets.slice(page*42,(page+1)*42);const cells=[];
 for(let j=0;j<subset.length;j++){
  const a=subset[j];const img=await sharp(a.file).resize(190,190,{fit:'inside'}).flatten({background:'#ffffff'}).png().toBuffer();
  const meta=await sharp(img).metadata();const title=`${page*42+j+1} · ${a.id.slice(-8)}`;
  const label=Buffer.from(`<svg width="200" height="30"><rect width="200" height="30" fill="white"/><text x="8" y="22" font-size="15">${title}</text></svg>`);
  cells.push({input:img,left:(j%7)*200+Math.floor((200-meta.width)/2),top:Math.floor(j/7)*225});cells.push({input:label,left:(j%7)*200,top:Math.floor(j/7)*225+192});
 }
 const out=`${root}/review/sources-${page+1}.jpg`;await sharp({create:{width:1400,height:Math.ceil(subset.length/7)*225,channels:3,background:'#eee'}}).composite(cells).jpeg({quality:90}).toFile(out);
}
await writeFile(`${root}/review/index.json`,JSON.stringify(assets.map((a,i)=>({n:i+1,id:a.id,title:a.title,file:a.file})),null,2));
console.log(`${assets.length} images in ${Math.ceil(assets.length/42)} contact sheets`);
