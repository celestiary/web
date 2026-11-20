"""Tile NOIRLab's noirlab2626d into the pyramid the Rubin app's image layer reads.

Rubin.md, "The imagery".  A quadtree in image space: level k is the image
reduced by 2^(N - k), N = ceil(log2(longest side / tile)), so level N is
full resolution and level 0 one tile; each level is cut into tile x tile
JPEGs named <level>/<x>_<y>.jpg (x right, y down; edge tiles are short).

  python3 -I tools/rubin/pyramid.py <noirlab2626d.jpg> <outDir> [--max-level K] [--tile 512] [--quality 82]

--max-level stops short of full resolution (the committed pyramid stops at
level 5, a quarter: 0.8"/px).  Omitted, it goes to level N (full, 0.2"/px:
about 290 MB of tiles, too big for the repo's LFS; Rubin.md says where it
would go).  Prints the levels for the manifest
(public/data/rubin/noirlab2626d.json).
"""
import json
import math
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def main():
    args = sys.argv[1:]
    src, out = args[0], args[1]
    opts = {'--max-level': None, '--tile': '512', '--quality': '82'}
    for i in range(2, len(args), 2):
        opts[args[i]] = args[i + 1]
    tile, quality = int(opts['--tile']), int(opts['--quality'])
    im = Image.open(src)
    w, h = im.size
    n = math.ceil(math.log2(max(w, h) / tile))
    top = n if opts['--max-level'] is None else min(n, int(opts['--max-level']))
    # The deepest level wanted, by the JPEG decoder's own reduction where it can
    # (draft), then exactly by resampling.
    f = 2 ** (n - top)
    tw, th = math.ceil(w / f), math.ceil(h / f)
    im.draft('RGB', (tw, th))
    im = im.convert('RGB')
    if im.size != (tw, th):
        im = im.resize((tw, th), Image.LANCZOS)
    levels = []
    for k in range(top, -1, -1):
        lw, lh = im.size
        cols, rows = math.ceil(lw / tile), math.ceil(lh / tile)
        os.makedirs(os.path.join(out, str(k)), exist_ok=True)
        for y in range(rows):
            for x in range(cols):
                box = (x * tile, y * tile, min(lw, (x + 1) * tile), min(lh, (y + 1) * tile))
                im.crop(box).save(os.path.join(out, str(k), f'{x}_{y}.jpg'), quality=quality, optimize=True,
                                  progressive=False)
        levels.append({'level': k, 'width': lw, 'height': lh, 'cols': cols, 'rows': rows})
        print(f'level {k}: {lw} x {lh}, {cols} x {rows} tiles', file=sys.stderr)
        if k > 0:
            im = im.resize((math.ceil(lw / 2), math.ceil(lh / 2)), Image.LANCZOS)
    print(json.dumps({'tileSize': tile, 'fullLevel': n, 'levels': sorted(levels, key=lambda l: l['level'])},
                     indent=1))


if __name__ == '__main__':
    main()
