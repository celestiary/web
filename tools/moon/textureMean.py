#!/usr/bin/env python3
"""The Moon colour map's numbers for its photometry (js/scene/lunarPhotometry.js,
MOON_TEXTURE_NEAR_MEAN; js/scene/Planet.md, "Lighting and exposure").

Prints the mean stored value over the near side's disc, weighted by projected
area (mu = cos lat cos lon, the disc a full Moon shows from Earth, centred on
0 N, 0 E), and the maria's and highlands' medians, which say the stretch is
linear in I/F: their ratio stored is ~2.1, as the Moon's albedos are, where
sRGB-decoded it would be ~4.4.

Usage: tools/moon/textureMean.py public/textures/moon.jpg
Needs Pillow and NumPy.  The map is equirectangular, -180 at the left edge.
"""
import sys

import numpy as np
from PIL import Image


def main(path):
    im = np.asarray(Image.open(path).convert('L')).astype(float) / 255
    h, w = im.shape
    lat = np.radians(90 - ((np.arange(h) + 0.5) / h * 180))
    lon = np.radians(((np.arange(w) + 0.5) / w * 360) - 180)
    lon2, lat2 = np.meshgrid(lon, lat)
    mu = np.cos(lat2) * np.cos(lon2)
    # Projected area of each texel: mu times its solid angle (cos lat).
    weight = np.clip(mu, 0, None) * np.cos(lat2)
    print(f'near-side disc mean (stored): {(im * weight).sum() / weight.sum():.4f}')
    lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)

    def median(a, la, lo, r=1.5):
        x0, x1 = int((lo - r + 180) / 360 * w), int((lo + r + 180) / 360 * w)
        y0, y1 = int((90 - la - r) / 180 * h), int((90 - la + r) / 180 * h)
        return float(np.median(a[y0:y1, x0:x1]))
    maria = [(8.5, 31.4), (28, 17.5), (33, -16), (18, -57), (-21, -17)]
    highlands = [(-20, 20), (-10, 10), (-40, 5), (0, 180), (20, -150)]
    for name, a in (('stored', im), ('sRGB-decoded', lin)):
        m = np.mean([median(a, *p) for p in maria])
        hl = np.mean([median(a, *p) for p in highlands])
        print(f'{name}: maria {m:.4f}, highlands {hl:.4f}, ratio {hl / m:.2f}')


if __name__ == '__main__':
    main(sys.argv[1])
