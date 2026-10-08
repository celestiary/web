#!/usr/bin/env python3
"""The Moon's normal map, public/textures/moon_normal.jpg (js/scene/Planet.md,
"Surface texture sources" and "Relief").

From LRO LOLA's global DEM as NASA Moon Trek serves it (LDEM 128 ppd v04,
WMTS, an 8-bit PNG stretch), at WMTS level 3: 16 x 8 tiles of 256 px, 4096 x
2048, -180 at the left edge, as the colour map.  The stretch is linear: its
1 lands on Antoniadi's floor (70.4 S, 172.4 W; -9.13 km) and its 255 on the
Selenean summit (5.4 N, 158.6 W; +10.78 km), the DEM's known lowest and
highest points, so a step is 78 m.  The heights are resampled to WIDTH x
WIDTH/2, blurred by 0.6 px against the steps, and turned into tangent-space
normals for three's SphereGeometry: x east (u), y north (v), z out; slopes
from centred differences over the texel's true size on a 1,737.4 km sphere.

Usage: tools/moon/lolaNormalMap.py OUT.jpg [WIDTH=2048] [QUALITY=90] [CACHE_DIR]
Needs Pillow and NumPy, and trek.nasa.gov.
"""
import io
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

TILE_URL = ('https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_DEM_Global_128ppd_v04/1.0.0/'
            'default/default028mm/{z}/{r}/{c}.png')
LEVEL = 3
RADIUS_M = 1737.4e3
LOW_M, HIGH_M = -9.13e3, 10.78e3


def stitch(cache):
    cols, rows = 2 ** (LEVEL + 1), 2 ** LEVEL
    img = Image.new('L', (cols * 256, rows * 256))
    for r in range(rows):
        for c in range(cols):
            path = os.path.join(cache, f'{LEVEL}_{r}_{c}.png') if cache else None
            if path and os.path.exists(path):
                data = open(path, 'rb').read()
            else:
                data = urllib.request.urlopen(TILE_URL.format(z=LEVEL, r=r, c=c), timeout=60).read()
                if path:
                    open(path, 'wb').write(data)
            img.paste(Image.open(io.BytesIO(data)).convert('LA').getchannel(0), (c * 256, r * 256))
    return img


def normals(dem, width):
    img = dem.resize((width, width // 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    h = LOW_M + ((np.asarray(img).astype(np.float64) - 1) * (HIGH_M - LOW_M) / 254)
    rows, cols = h.shape
    lat = np.radians(90 - ((np.arange(rows) + 0.5) * 180 / rows))[:, None]
    # East wraps round; north is up the image (row 0 is the north edge).
    dh_east = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / \
        (2 * RADIUS_M * np.maximum(np.cos(lat), 0.02) * (2 * np.pi / cols))
    padded = np.vstack([h[:1], h, h[-1:]])
    dh_north = (padded[:-2] - padded[2:]) / (2 * RADIUS_M * (np.pi / rows))
    n = np.dstack([-dh_east, -dh_north, np.ones_like(h)])
    return n / np.linalg.norm(n, axis=2, keepdims=True)


def main():
    out = sys.argv[1]
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 90
    cache = sys.argv[4] if len(sys.argv) > 4 else None
    if cache:
        os.makedirs(cache, exist_ok=True)
    dem = stitch(cache)
    lo, hi = dem.getextrema()
    assert (lo, hi) == (1, 255), f'stretch changed: {lo}..{hi}'
    n = normals(dem, width)
    rgb = np.clip(np.round(((n * 0.5) + 0.5) * 255), 0, 255).astype(np.uint8)
    Image.fromarray(rgb, 'RGB').save(out, quality=quality, subsampling=0)
    slope = np.degrees(np.arccos(n[..., 2]))
    print(f'{out}: {width}x{width // 2}, slope median {np.median(slope):.1f} deg, '
          f'p99 {np.percentile(slope, 99):.1f}, max {slope.max():.1f}')


if __name__ == '__main__':
    main()
