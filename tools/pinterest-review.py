"""Contact sheets for downloaded images, including a placeholder for unsupported encodings."""
from pathlib import Path
from PIL import Image, ImageDraw
import json
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'art/pinterest-board')
folder = root/'review'
folder.mkdir(exist_ok=True)
assets = [a for a in json.loads((root/'assets.json').read_text('utf8')) if a['status'] == 'downloaded']
(folder/'index.json').write_text(json.dumps([{'n': i+1, **a} for i, a in enumerate(assets)], ensure_ascii=False, indent=2)+'\n', 'utf8')
errors = []
for start in range(0, len(assets), 42):
    items = assets[start:start+42]
    canvas = Image.new('RGB', (1400, ((len(items)+6)//7)*225), '#eee')
    draw = ImageDraw.Draw(canvas)
    for j, a in enumerate(items):
        x, y = (j % 7)*200, (j//7)*225
        try:
            im = Image.open(a['file']).convert('RGBA')
            im.thumbnail((190, 190))
            cell = Image.new('RGBA', (200, 190), 'white')
            cell.alpha_composite(im, ((200-im.width)//2, (190-im.height)//2))
            canvas.paste(cell.convert('RGB'), (x, y))
        except Exception as error:
            errors.append({'n': start+j+1, 'id': a['id'], 'error': str(error)})
            draw.text((x+5, y+75), 'UNSUPPORTED IMAGE', fill='red')
        draw.text((x+5, y+195), f'{start+j+1} / {a["id"][-8:]}', fill='black')
    canvas.save(folder/f'sources-{start//42+1}.jpg', quality=92)
print(json.dumps({'images': len(assets), 'sheets': (len(assets)+41)//42, 'errors': errors}, ensure_ascii=False))
