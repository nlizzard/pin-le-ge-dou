"""Reviewed Pinterest recommendation charts -> fixed-order, deduplicated game catalogue.

Run from the repository root. Pillow and NumPy are required. --publish requires
enough reviewed patterns to reach exactly 1018; it never invents filler levels.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import re
from PIL import Image, ImageDraw
import numpy as np

ROOT = Path('art/pinterest-recommendations')
spec = importlib.util.spec_from_file_location('grid', Path('tools/pinterest-grid.py'))
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)


def read(path):
    return json.loads(Path(path).read_text('utf8'))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', 'utf8')


def pixels(p):
    w = max(map(len, p['rows']))
    out = np.zeros((len(p['rows']), w, 4), np.uint8)
    for y, row in enumerate(p['rows']):
        for x, c in enumerate(row):
            if c not in '. ':
                out[y, x] = [int(p['palette'][c][i:i+2], 16) for i in [1, 3, 5]]+[255]
    return out


def exact(p):
    a = pixels(p)
    return hashlib.sha256(str(a.shape).encode()+a.tobytes()).hexdigest()


def compact(p):
    """Compare the motif, ignoring a plain edge background and harmless colour noise."""
    a = pixels(p)
    rgb = a[:, :, :3].astype(np.int16)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    mask = (a[:, :, 3] > 0) & (np.linalg.norm(rgb-bg, axis=-1) > 35)
    coords = np.argwhere(mask)
    if len(coords):
        lo, hi = coords.min(axis=0), coords.max(axis=0)+1
        a = a[lo[0]:hi[0], lo[1]:hi[1]]
    image = Image.fromarray(a)
    base = Image.new('RGBA', image.size, 'white')
    base.alpha_composite(image)
    small = np.array(base.convert('RGB').resize((24, 24), Image.Resampling.BOX))
    # A quantized signature is a conservative second pass, not a replacement for visual review.
    return hashlib.sha256((small//48).tobytes()).hexdigest()


def contact_sheets(records):
    good = [r for r in records if r['status'] == 'converted']
    folder = ROOT/'review'
    folder.mkdir(exist_ok=True)
    for start in range(0, len(good), 42):
        subset = good[start:start+42]
        canvas = Image.new('RGB', (1400, 225*((len(subset)+6)//7)), '#eee')
        draw = ImageDraw.Draw(canvas)
        for j, r in enumerate(subset):
            im = Image.open(ROOT/'converted'/f'{r["key"]}.png')
            im.thumbnail((190, 190), Image.Resampling.NEAREST)
            cell = Image.new('RGBA', (200, 190), 'white')
            cell.alpha_composite(im, ((200-im.width)//2, (190-im.height)//2))
            x, y = (j % 7)*200, (j//7)*225
            canvas.paste(cell.convert('RGB'), (x, y))
            draw.text((x+4, y+194), f'{r["n"]}:{r["part"]} {r["w"]}x{r["h"]} {r["method"]}', fill='black')
        canvas.save(folder/f'converted-{start//42+1}.jpg', quality=92)


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--publish', action='store_true')
    options = args.parse_args()
    (ROOT/'converted').mkdir(exist_ok=True)
    assets = [a for a in read(ROOT/'assets.json') if a['status'] == 'downloaded']
    approvals = read(ROOT/'curation.json')
    board_url = read(ROOT/'manifest.json')['boardUrl']
    exclusions = read('art/pinterest-board/exclusions.json')
    excluded = {e['key'] for e in exclusions}
    existing = [read(p) for p in sorted(Path('levels').glob('*.json')) if p.name != 'credits.json']
    existing = [p for p in existing if p['key'] not in excluded and not p['key'].startswith('pinterest-rec-')]
    exacts = {exact(p): p['key'] for p in existing}
    compacts = {compact(p): p['key'] for p in existing}
    # Also compare against hand-drawn and generated campaign art, not only imported files.
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for d in read('server/generated/levels.json'):
        if d['key'] in excluded or d['key'].startswith('pinterest-rec-'):
            continue
        p = {'palette': {alphabet[i]: c for i, c in enumerate(d['colors'])},
             'rows': [''.join('.' if c < 0 else alphabet[c] for c in d['target'][y*d['w']:(y+1)*d['w']]) for y in range(d['h'])]}
        exacts[exact(p)], compacts[compact(p)] = d['key'], d['key']
    sha_seen = {a['sha256']: a['id'] for a in read('art/pinterest-board/assets.json') if a.get('sha256')}
    records, candidates = [], []
    cache_path = ROOT/'converted/cache.json'
    cache = read(cache_path) if cache_path.exists() else {}
    for n, a in enumerate(assets, 1):
        base = {'n': n, 'pinId': a['id'], 'url': a['pin']}
        conf = approvals.get(a['id'])
        if not conf or not conf.get('approved'):
            records.append({**base, 'status': 'skipped', 'reason': (conf or {}).get('skip', '未入选：未完成图案质量审核')})
            continue
        if conf.get('flagFree') is not True:
            records.append({**base, 'status': 'skipped', 'reason': '尚未完成国旗排除审核'})
            continue
        if re.search(r'国旗|國旗|旗帜|旗幟|\bflags?\b|bandera|bandeira|drapeau', a['title'], re.I):
            records.append({**base, 'status': 'skipped', 'reason': '国旗及旗帜类素材过滤'})
            continue
        if a['sha256'] in sha_seen:
            records.append({**base, 'status': 'duplicate-image', 'sameAs': sha_seen[a['sha256']]})
            continue
        sha_seen[a['sha256']] = a['id']
        parts = conf.get('parts', [conf])
        for j, part in enumerate(parts, 1):
            key = f'pinterest-rec-{a["id"]}'+(f'-{j:02}' if len(parts) > 1 else '')
            name = part.get('name', conf.get('name', f'像素收藏 · {n:03}'))
            item = {**base, 'part': j, 'key': key, 'name': name}
            try:
                revision = hashlib.sha256(json.dumps(['native-trim-v5', a['sha256'], name, part], sort_keys=True).encode()).hexdigest()
                saved = ROOT/'converted'/f'{key}.json'
                if cache.get(key, {}).get('revision') == revision and saved.exists():
                    p, meta = read(saved), cache[key]['meta']
                else:
                    p, meta = grid.convert(a['file'], name, key, {'keep': True, 'trim': True, 'recover': True, **part})
                    cache[key] = {'revision': revision, 'meta': meta}
                digest, shape = exact(p), compact(p)
                duplicate = exacts.get(digest) or compacts.get(shape)
                if duplicate:
                    records.append({**item, 'status': 'duplicate-pattern', 'sameAs': duplicate})
                    continue
                exacts[digest], compacts[shape] = key, key
                p['source'] = {'url': a['pin'], 'image': a['image'], 'title': a['title'],
                               'author': '原作者见来源页面', 'license': '来源网页未标注授权',
                               'conversion': meta['method'], 'section': '找寻更多点子',
                               'board': board_url}
                write(ROOT/'converted'/f'{key}.json', p)
                grid.render(p, ROOT/'converted'/f'{key}.png')
                records.append({**item, 'status': 'converted', 'w': max(map(len, p['rows'])),
                                'h': len(p['rows']), 'method': meta['method']})
                candidates.append(p)
            except Exception as error:
                records.append({**item, 'status': 'failed', 'reason': str(error)})
        if n % 100 == 0:
            print(f'候选处理 {n}/{len(assets)} · 可用图案 {len(candidates)}', flush=True)
    write(ROOT/'conversion-report.json', records)
    write(cache_path, cache)
    contact_sheets(records)
    print(json.dumps({'candidates': len(candidates), 'failed': [r for r in records if r['status'] == 'failed']}, ensure_ascii=False), flush=True)
    if not options.publish:
        return
    previous = read(ROOT/'previous-catalog.json')
    kept = [p for p in previous if p['key'] not in excluded]
    required = 1018-len(kept)
    if len(candidates) < required:
        raise SystemExit(f'只取得 {len(candidates)} 幅合格图案，还需 {required-len(candidates)} 幅；没有发布不足1018的目录')
    selected = candidates[:required]
    new_keys = [p['key'] for p in selected]
    # Fill the excluded flag's old slot once, then append the remaining reviewed art.
    replacements = iter(new_keys)
    order = [p['key'] if p['key'] not in excluded else next(replacements) for p in previous]
    used = set(order)
    order += [key for key in new_keys if key not in used]
    if len(order) != 1018 or len(set(order)) != 1018:
        raise ValueError('目录顺序或去重校验失败')
    for p in selected:
        write(Path('levels')/f'{p["key"]}.json', p)
    for path in Path('levels').glob('pinterest-rec-*.json'):
        if path.stem not in new_keys:
            path.unlink()  # Only generated files in this exact repository folder.
    write(ROOT/'catalog-order.json', order[200:])
    credits = [c for c in read('levels/credits.json') if not c['key'].startswith('pinterest-rec-') and c['key'] not in excluded]
    credits += [{'key': p['key'], 'name': p['name'], **p['source']} for p in selected]
    write('levels/credits.json', credits)
    for r in records:
        if r['status'] == 'converted':
            r['status'] = 'imported' if r['key'] in new_keys else 'reserve'
    write(ROOT/'import-report.json', {'section': '找寻更多点子', 'sourcePinCount': len(assets),
        'targetPatternCount': 1018, 'previousCount': len(previous), 'excluded': exclusions,
        'newPatternCount': len(selected), 'unchangedPatternCount': len(kept),
        'replacedSlots': [{'id': p['id'], 'oldKey': p['key'], 'newKey': order[p['id']-1]} for p in previous if p['key'] in excluded],
        'records': records})
    print(f'已发布 {len(selected)} 幅新图案 · 目录共 {len(order)} 张 · 原有非旗帜关卡编号不变', flush=True)


if __name__ == '__main__':
    main()
