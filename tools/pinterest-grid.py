"""Recover square-lattice pixel charts from locally downloaded Pinterest references."""
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
import json, math, sys
ROOT=Path('art/pinterest-board')

def pitch_profile(a, axis):
    p=np.abs(np.diff(a.astype(np.float32),axis=axis)).mean(axis=1-axis).mean(axis=-1)
    p=np.r_[0.,p]; n=len(p)
    centered=p-np.convolve(p,np.ones(min(81,n))/min(81,n),mode='same')
    centered=np.maximum(centered,0)
    size=1<<int(math.ceil(math.log2(max(32,n*16))))
    ft=np.abs(np.fft.rfft(centered*np.hanning(n),n=size))
    freq=np.fft.rfftfreq(size)
    ids=np.where((freq>=1/min(96,max(5,n/8)))&(freq<=1/2.8))[0]
    peaks=[i for i in ids[1:-1] if ft[i]>=ft[i-1] and ft[i]>=ft[i+1]]
    peaks=sorted(peaks,key=lambda i:ft[i],reverse=True)[:10]
    candidates=[(float(1/freq[i]),float(ft[i])) for i in peaks]
    if not candidates:return None,p
    best=candidates[0]
    # Thin grid boundaries produce nearby harmonics; prefer the complete cell pitch.
    for pitch,amp in candidates[1:]:
        if pitch>best[0]*1.8 and pitch<best[0]*2.2 and amp>best[1]*.68:best=(pitch,amp)
    pitch=best[0]
    def coherence(period):
        z=np.dot(centered,np.exp(-2j*np.pi*np.arange(n)/period))
        return abs(z),float((-np.angle(z)/(2*np.pi)*period)%period)
    trials=np.arange(max(2.8,pitch-.25),pitch+.251,.01)
    pitch=max(trials,key=lambda t:coherence(t)[0]);amp,phase=coherence(pitch)
    confidence=amp/(float(centered.sum())+1e-9)
    return {'pitch':float(pitch),'phase':phase,'confidence':confidence,'candidates':candidates[:4]},p

if __name__=='__main__':
 assets=json.loads((ROOT/'assets.json').read_text('utf8'))
 selected=set(sys.argv[1:])
 for i,a in enumerate(assets):
  if a['status']!='downloaded' or (selected and str(i+1) not in selected):continue
  img=Image.open(a['file']).convert('RGB');img.thumbnail((1600,1600));arr=np.array(img)
  x,_=pitch_profile(arr,1);y,_=pitch_profile(arr,0)
  print(json.dumps({'n':i+1,'id':a['id'],'size':img.size,'x':x,'y':y}))

# Conversion helpers are also imported by the reproducible board importer.
def sample_lattice(arr, x, y):
    h,w=arr.shape[:2]
    def centers(size,meta):
        p,phase=meta['pitch'],meta['phase']
        return [phase+(i+.5)*p for i in range(-2,int(size/p)+2) if p*.25<=phase+(i+.5)*p<=size-p*.25]
    xs,ys=centers(w,x),centers(h,y)
    if not xs or not ys:raise ValueError('No grid cells')
    result=np.empty((len(ys),len(xs),3),np.uint8)
    rx,ry=max(1,x['pitch']*.27),max(1,y['pitch']*.27)
    for j,cy in enumerate(ys):
        for i,cx in enumerate(xs):
            patch=arr[max(0,round(cy-ry)):min(h,round(cy+ry)+1),max(0,round(cx-rx)):min(w,round(cx+rx)+1)]
            result[j,i]=np.median(patch.reshape(-1,3),axis=0)
    return result

def component_cleanup(grid, largest_only=False):
    h,w=grid.shape; seen=np.zeros((h,w),bool); comps=[]
    for y in range(h):
        for x in range(w):
            if seen[y,x] or grid[y,x]<0:continue
            q=[(y,x)];seen[y,x]=True;c=[]
            while q:
                yy,xx=q.pop();c.append((yy,xx))
                for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
                    ny,nx=yy+dy,xx+dx
                    if 0<=ny<h and 0<=nx<w and not seen[ny,nx] and grid[ny,nx]>=0:seen[ny,nx]=True;q.append((ny,nx))
            comps.append(c)
    largest=max((len(c) for c in comps),default=0)
    for c in comps:
        if len(c)<min(4,max(2,largest*.004)) or (largest_only and len(c)<largest):
            for y,x in c:grid[y,x]=-1
    return grid

def pattern_from_cells(cells, name, key, keep=False, largest_only=False):
    im=Image.fromarray(cells).quantize(colors=24,method=Image.Quantize.MEDIANCUT)
    labels=np.array(im); pal=np.array(im.getpalette(),np.uint8).reshape(-1,3)
    counts=np.bincount(labels.ravel(),minlength=len(pal)); order=np.argsort(-counts)
    colors=[];mapping={}
    for i in order:
        if not counts[i]:continue
        color=pal[i].astype(float)
        if color.min()>232:color=np.array([255,255,255])
        if color.max()<30:color=np.array([24,24,24])
        nearest=next((j for j,c in enumerate(colors) if np.linalg.norm(color-c)<32),None)
        if nearest is None:nearest=len(colors);colors.append(color)
        mapping[int(i)]=nearest
    grid=np.array([[mapping[int(c)] for c in row] for row in labels],np.int16)
    if not keep:
        border=np.r_[grid[0],grid[-1],grid[:,0],grid[:,-1]];bg=np.bincount(border).argmax()
        # Only remove the edge-connected background, preserving enclosed white details.
        color=np.array(colors[bg]);near={i for i,c in enumerate(colors) if np.linalg.norm(c-color)<52}
        q=[(y,x) for y in range(len(grid)) for x in [0,len(grid[0])-1]]+[(y,x) for x in range(len(grid[0])) for y in [0,len(grid)-1]]
        while q:
            y,x=q.pop()
            if grid[y,x]<0 or int(grid[y,x]) not in near:continue
            grid[y,x]=-1
            for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
                ny,nx=y+dy,x+dx
                if 0<=ny<len(grid) and 0<=nx<len(grid[0]):q.append((ny,nx))
        grid=component_cleanup(grid,largest_only)
    points=np.argwhere(grid>=0)
    if len(points)<8:raise ValueError('Too little visible art')
    lo,hi=points.min(axis=0),points.max(axis=0)+1;grid=grid[lo[0]:hi[0],lo[1]:hi[1]]
    used=np.unique(grid[grid>=0])
    if len(used)<2:
        # A one-colour motif needs its original white surround to make a playable puzzle.
        colors.append(np.array([255,255,255]));grid=np.pad(np.where(grid<0,len(colors)-1,grid),1,constant_values=len(colors)-1);used=np.unique(grid)
    if max(grid.shape)>128:
        scale=128/max(grid.shape);grid=np.array(Image.fromarray(grid.astype(np.int32),mode='I').resize((max(1,round(grid.shape[1]*scale)),max(1,round(grid.shape[0]*scale))),Image.Resampling.NEAREST));used=np.unique(grid[grid>=0])
    chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    remap={int(v):chars[i] for i,v in enumerate(used)}
    palette={remap[int(v)]:'#'+''.join(f'{int(round(c)):02x}' for c in colors[v]) for v in used}
    rows=[''.join('.' if c<0 else remap[int(c)] for c in row).rstrip('.') for row in grid]
    return {'key':key,'name':name,'palette':palette,'rows':rows}

def convert(file,name,key,spec=None):
    spec=spec or {};img=Image.open(file).convert('RGBA')
    flat=Image.new('RGBA',img.size,'white');flat.alpha_composite(img);img=flat.convert('RGB')
    if 'crop' in spec:
        x,y,w,h=spec['crop'];W,H=img.size;img=img.crop((round(x*W),round(y*H),round((x+w)*W),round((y+h)*H)))
    img.thumbnail((1600,1600));arr=np.array(img)
    x,_=pitch_profile(arr,1);y,_=pitch_profile(arr,0)
    if 'pitch' in spec:
        p=spec['pitch']
        def fixed(axis):
            _,profile=pitch_profile(arr,axis)
            z=np.dot(profile-profile.mean(),np.exp(-2j*np.pi*np.arange(len(profile))/p))
            phase=float((-np.angle(z)/(2*np.pi)*p)%p)
            return {'pitch':p,'phase':spec.get('phase',[phase,phase])[1-axis],'confidence':1}
        x,y=fixed(1),fixed(0)
    reliable=x and y and min(x['confidence'],y['confidence'])>.58 and abs(x['pitch']/y['pitch']-1)<.16
    if 'grid' in spec:
        cols,rows=spec['grid'];x={'pitch':img.width/cols,'phase':0};y={'pitch':img.height/rows,'phase':0}
        cells=sample_lattice(arr,x,y);method='specified-grid'
    elif reliable and not spec.get('resize'):
        cells=sample_lattice(arr,x,y);method='lattice'
    else:
        size=spec.get('resize',48);scale=size/max(img.size)
        cells=np.array(img.resize((max(1,round(img.width*scale)),max(1,round(img.height*scale))),Image.Resampling.BOX));method='resample'
    pattern=pattern_from_cells(cells,name,key,spec.get('keep',False),spec.get('largestOnly',False))
    return pattern,{'method':method,'x':x,'y':y,'sampleSize':[len(cells[0]),len(cells)]}

def render(pattern,path,scale=8):
    w=max(map(len,pattern['rows']));h=len(pattern['rows']);im=Image.new('RGBA',(w,h));px=im.load()
    for y,row in enumerate(pattern['rows']):
        for x,c in enumerate(row):
            if c!='.':px[x,y]=tuple(int(pattern['palette'][c][i:i+2],16) for i in [1,3,5])+(255,)
    im.resize((w*scale,h*scale),Image.Resampling.NEAREST).save(path)
