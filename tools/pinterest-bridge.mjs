/** Local-only handoff for the board's visible DOM metadata; never reads browser credentials. */
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const target = new URL('../art/pinterest-board/manifest.json', import.meta.url);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>拼豆收藏板导入</title><style>body{font:16px system-ui;max-width:800px;margin:60px auto;color:#65516f}textarea{display:block;width:100%;height:300px;margin:20px 0}button{padding:12px 24px}p{line-height:1.8}</style><h1>拼豆收藏板导入</h1><p>将浏览器中可见的图案清单保存到当前项目，用于生成关卡。此工具只接收公开图片链接，不接收登录信息。</p><form method="post" action="/manifest"><label>收藏板清单<textarea name="payload" aria-label="收藏板清单"></textarea></label><button>保存图案清单</button></form></html>`;
http.createServer(async (req,res)=>{
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);return;}
 if(req.method==='GET'&&req.url==='/proof'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<meta charset="utf-8"><title>导入结果截图</title><form method="post" action="/proof"><label>截图数据<textarea name="payload" aria-label="截图数据"></textarea></label><button>保存结果截图</button></form>');return;}
 if(req.method==='POST'&&req.headers.origin!=='http://127.0.0.1:5186'){res.writeHead(403);res.end();return;}
 if(req.method==='POST'&&req.url==='/proof'){
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>2_000_000)throw new Error('截图过大');}
   const screenshot=Buffer.from(new URLSearchParams(body).get('payload')||'','base64');
   const format=screenshot.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':screenshot.subarray(0,3).toString('hex')==='ffd8ff'?'jpg':null;
   if(!format)throw new Error('仅接受 PNG 或 JPEG 截图');
   await mkdir(new URL('../art/pinterest-board/review/',import.meta.url),{recursive:true});
   await writeFile(new URL(`../art/pinterest-board/review/game-imported.${format}`,import.meta.url),screenshot);
   res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<meta charset="utf-8"><h1>结果截图已保存</h1>');
  }catch(e){res.writeHead(400);res.end(e.message);}return;
 }
 if(req.method!=='POST'||req.url!=='/manifest'){res.writeHead(404);res.end();return;}
 let body='';try{
  for await(const chunk of req){body+=chunk;if(body.length>2_000_000)throw new Error('清单过大');}
  const data=JSON.parse(new URLSearchParams(body).get('payload')||'null');
  if(!Array.isArray(data?.pins)||data.pins.length>1000)throw new Error('图案清单无效');
  for(const p of data.pins){if(new URL(p.href).hostname!=='jp.pinterest.com')throw new Error('来源无效');for(const img of p.images||[]){if(new URL(img.src).hostname!=='i.pinimg.com')throw new Error('图片地址无效');}}
  await mkdir(new URL('.',target),{recursive:true});await writeFile(target,JSON.stringify(data,null,2)+'\n');
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(`<meta charset="utf-8"><title>图案清单已保存</title><h1>图案清单已保存</h1><p>已保存 ${data.pins.length} 张 Pin 图的来源与图片信息。</p>`);
 }catch(e){res.writeHead(400,{'content-type':'text/plain;charset=utf-8'});res.end(e.message);}
}).listen(5186,'127.0.0.1',()=>console.log('Pinterest board manifest bridge: http://127.0.0.1:5186/'));
