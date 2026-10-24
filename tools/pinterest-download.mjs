import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.argv[2]||'art/pinterest-board';
await mkdir(`${root}/originals`,{recursive:true});
const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
const assets=[];
let cursor=0;
async function worker(){while(cursor<manifest.pins.length){const index=cursor++,pin=manifest.pins[index],id=pin.href.match(/\/pin\/(\d+)/)[1];
 const record={id,pin:pin.href,title:pin.title.replace(/ Pin 图页面$/,''),images:pin.images,status:'pending'};
 const img=pin.images[0];if(!img){record.status='no-image';assets.push(record);continue;}
 const original=img.srcset?.split(',').map(s=>s.trim().split(/\s+/)[0]).find(s=>s.includes('/originals/'));
 const urls=[...new Set([original,img.src].filter(Boolean))];const file=`${root}/originals/${id}.bin`;
 try{let buffer;try{buffer=await readFile(file);record.image=original||img.src;}catch{
  let last;for(const url of urls){try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);buffer=Buffer.from(await response.arrayBuffer());if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('not-image');record.image=url;break;}catch(e){last=e.message;}}
  if(!buffer)throw new Error(last);await writeFile(file,buffer);
 }
 record.status='downloaded';record.file=file;record.sha256=createHash('sha256').update(buffer).digest('hex');record.bytes=buffer.length;
 }catch(e){record.status='download-failed';record.error=e.message;}
 assets.push(record);if(assets.length%15===0)console.log(`${assets.length}/${manifest.pins.length} processed`);
}}
await Promise.all(Array.from({length:4},worker));
assets.sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(`${root}/assets.json`,JSON.stringify(assets,null,2)+'\n');
console.log(JSON.stringify({pins:assets.length,downloaded:assets.filter(a=>a.status==='downloaded').length,uniqueImages:new Set(assets.filter(a=>a.sha256).map(a=>a.sha256)).size,failed:assets.filter(a=>a.status!=='downloaded').map(a=>({id:a.id,status:a.status,error:a.error}))}));
