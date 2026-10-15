#!/usr/bin/env python3
"""The bundled cloud texture's small copy, public/textures/earth/earth_atmos_fill.jpg
(js/scene/Planet.md, "Clouds", "The bundled texture").

A daily cloud map fills the pixels the satellites didn't see from the bundled
texture (earth_atmos.jpg, 2048 x 1024, 1.4 MB).  Those are mostly the polar
night, which is dark, so a coarser copy does for them: the same picture
resampled (Lanczos) to WIDTH x WIDTH/2 and saved as a progressive greyscale
JPEG.  At 1024 x 512, quality 85 it is 128 KB.  Against the original, both
resampled (bilinear) to the cloud map's 2560 x 1280 and stretched to coverage
as cloudSource.js does, the coverage differs by this much, of 255, on average
poleward of 70 degrees and over the globe:

    1536 x 768   257 KB   1.3   2.8
    1024 x 512   128 KB   2.2   4.5
     512 x 256    38 KB   4.7   8.3

Where a daily map's gaps are not polar (a tile no layer served, MODIS's
wedges at the equator) the original is used, not this.

Usage: tools/clouds/bundledFill.py [SRC.jpg] [OUT.jpg] [WIDTH=1024] [QUALITY=85]
Needs Pillow.
"""
import sys

from PIL import Image

SRC = 'public/textures/earth/earth_atmos.jpg'
OUT = 'public/textures/earth/earth_atmos_fill.jpg'


def main(argv):
    src = argv[1] if len(argv) > 1 else SRC
    out = argv[2] if len(argv) > 2 else OUT
    width = int(argv[3]) if len(argv) > 3 else 1024
    quality = int(argv[4]) if len(argv) > 4 else 85
    image = Image.open(src).convert('L')
    image.resize((width, width // 2), Image.LANCZOS).save(
        out, 'JPEG', quality=quality, optimize=True, progressive=True)
    print(f'{out}: {width} x {width // 2}, quality {quality}')


if __name__ == '__main__':
    main(sys.argv)
