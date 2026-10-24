from pathlib import Path
import json,sys,hashlib,importlib.util
from PIL import Image,ImageDraw
root=Path('art/pinterest-board');root.joinpath('converted').mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('grid',Path('tools/pinterest-grid.py'));grid=importlib.util.module_from_spec(spec);spec.loader.exec_module(grid)
assets=json.loads((root/'assets.json').read_text('utf8'));assets=[a for a in assets if a['status']=='downloaded']
overrides=json.loads((root/'overrides.json').read_text('utf8')) if (root/'overrides.json').exists() else {}
report=[];seen={};shapes={}

def fingerprint(p):
 width=max(map(len,p['rows']))
 pixels=[[p['palette'][c].lower() if c not in '. ' else None for c in row.ljust(width,'.')] for row in p['rows']]
 return hashlib.sha256(json.dumps(pixels).encode()).hexdigest()
for n,a in enumerate(assets,1):
 base={'n':n,'pinId':a['id'],'url':a['pin'],'originalTitle':a['title']}
 if a['sha256'] in seen:report.append({**base,'status':'duplicate','sameAs':seen[a['sha256']]});continue
 seen[a['sha256']]=a['id']
 conf=overrides.get(a['id'],{})
 if conf.get('skip'):report.append({**base,'status':'skipped','reason':conf['skip']});continue
 parts=conf.get('parts',[conf])
 for j,part in enumerate(parts):
  name=part.get('name',conf.get('name',a['title']))
  if not name or name in ['未命名','Pixel Art, 8-Bit Art, Lego Art','Welcome!','YouTube','NameBright - Coming Soon']:name=f'拼豆收藏 · {n:03}'
  if len(parts)>1 and 'name' not in part:name+=f' · {j+1}'
  key=f'pinterest-{a["id"]}'+(f'-{j+1:02}' if len(parts)>1 else '')
  try:
   p,meta=grid.convert(a['file'],name[:32],key,part)
   digest=fingerprint(p)
   if digest in shapes:
    report.append({**base,'status':'duplicate-pattern','key':key,'sameAs':shapes[digest]});continue
   shapes[digest]=key
   p['source']={'url':a['pin'],'image':a['image'],'title':a['title'],'author':'原作者见来源页面','license':'来源网页未标注授权','conversion':meta['method'],'board': 'https://jp.pinterest.com/o4724o4724/%E6%8B%BC%E8%B1%86%E5%9C%96%E6%A1%88/'}
   (root/'converted'/f'{key}.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n','utf8');grid.render(p,root/'converted'/f'{key}.png')
   report.append({**base,'status':'converted','key':key,'name':name,'w':max(map(len,p['rows'])),'h':len(p['rows']),'colors':len(p['palette']),**meta})
  except Exception as e:report.append({**base,'status':'failed','key':key,'reason':str(e)})
(root/'conversion-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
converted=[r for r in report if r['status']=='converted']
for start in range(0,len(converted),42):
 subset=converted[start:start+42];canvas=Image.new('RGB',(1400,225*((len(subset)+6)//7)),'#eee');draw=ImageDraw.Draw(canvas)
 for j,r in enumerate(subset):
  im=Image.open(root/'converted'/f'{r["key"]}.png');im.thumbnail((190,190),Image.Resampling.NEAREST);bg=Image.new('RGBA',(200,190),'white');bg.alpha_composite(im,((200-im.width)//2,(190-im.height)//2));x=(j%7)*200;y=(j//7)*225;canvas.paste(bg.convert('RGB'),(x,y));draw.text((x+4,y+194),f'{r["n"]}: {r["w"]}x{r["h"]} {r["method"]}',fill='black')
 canvas.save(root/'review'/f'converted-{start//42+1}.jpg',quality=92)
print(json.dumps({'converted':len(converted),'duplicates':len([r for r in report if r['status']=='duplicate']),'failed':[r for r in report if r['status']=='failed']},ensure_ascii=False))

if '--publish' in sys.argv:
 if any(r['status']=='failed' for r in report):raise SystemExit('Conversion failures must be resolved before publishing')
 levels=Path('levels');levels.mkdir(exist_ok=True)
 credits_path=levels/'credits.json'
 credits=json.loads(credits_path.read_text('utf8')) if credits_path.exists() else []
 credits=[c for c in credits if not c['key'].startswith('pinterest-')]
 for r in converted:
  p=json.loads((root/'converted'/f'{r["key"]}.json').read_text('utf8'))
  if len(p['palette'])<2:raise ValueError(f'Unplayable one-colour pattern: {p["key"]}')
  (levels/f'{p["key"]}.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n','utf8')
  credits.append({'key':p['key'],'name':p['name'],**p['source']})
 credits_path.write_text(json.dumps(credits,ensure_ascii=False,indent=2)+'\n','utf8')
 manifest=json.loads((root/'manifest.json').read_text('utf8'))
 all_assets=json.loads((root/'assets.json').read_text('utf8'))
 records=[]
 for a in all_assets:
  rows=[r for r in report if r['pinId']==a['id']]
  if a['status']=='no-image':rows=[{'status':'skipped','reason':'已打开详情页核对：DIY toy | Funny toy 为折纸玩具视频，没有拼豆图案'}]
  records.append({'pinId':a['id'],'url':a['pin'],'items':[{k:r[k] for k in ['status','key','name','sameAs','reason','w','h','method'] if k in r} for r in rows]})
 audit={'board':manifest['boardUrl'],'displayedPinCount':manifest['displayedCount'],'accessiblePinCount':len(all_assets),'unavailablePinCount':manifest['displayedCount']-len(all_assets),'unavailableReason':'收藏板完整向下及向上滚动多轮后仍只提供191个独立Pin；其余16个没有出现在页面，无法取得链接或原图。推荐区与推广卡片不计入本收藏板。','importedLevelCount':len(converted),'exactDuplicateImages':sum(r['status']=='duplicate' for r in report),'duplicatePatterns':sum(r['status']=='duplicate-pattern' for r in report),'approximatePhotoLevelCount':sum(r['method']=='resample' for r in converted),'records':records}
 (root/'import-report.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n','utf8')
 print(f'Published {len(converted)} level files and credits; every accessible Pin is recorded in import-report.json')

