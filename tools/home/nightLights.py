#!/usr/bin/env python3
"""Earth's city light per 5° cell, for the homepage tour's choice of which
night side to fly over (js/nightSide.js; DESIGN.md "The tour";
js/scene/Planet.md, "City light per cell").

From the night-lights texture the Earth material loads,
public/textures/earth/earth_night.jpg (NASA's VIIRS Black Marble 2016,
3600 x 1800, equirectangular, -180° at the left edge), in stored values
(the 8-bit value over 255, lit as linear: js/scene/HDR.md).

The texture is a picture: under the lights it carries a bluish floor
(moonlit snow and desert, airglow; e.g. Greenland 42, 48, 80 and the Sahara
37, 34, 63) where city light is warm (New York's 158, 145, 123).  So a
texel's city light is its red over the floor's: max(0, R - 0.6 B - 8/255),
which is 0 over every floor (snow, desert, ocean, the taiga) and most of
the red of a lit texel.  Each cell's value is the sum of that over its
texels, each weighted by its area (cos lat), so a cell's value is its
light, not its brightness: a cell near the pole counts for less.  Scaled
so the brightest cell is 1000, rounded.

Output: {"cellDeg": 5, "lights": [[...72 values...] x 36 rows]}, rows from
90° N down, columns from -180° E.

Usage: tools/home/nightLights.py > js/scene/nightLights.json
Run from the repository root.  Needs Pillow and NumPy.
"""
import json

import numpy as np
from PIL import Image


TEXTURE = 'public/textures/earth/earth_night.jpg'
CELL_DEG = 5
# The floor's red, as a share of its blue, and a margin over it.
FLOOR_RED_PER_BLUE = 0.6
FLOOR_MARGIN = 8 / 255
SCALE = 1000


def main():
    im = np.asarray(Image.open(TEXTURE).convert('RGB')).astype(float) / 255
    h, w = im.shape[:2]
    light = np.maximum(0, im[:, :, 0] - (FLOOR_RED_PER_BLUE * im[:, :, 2]) - FLOOR_MARGIN)
    lat = np.radians(90 - ((np.arange(h) + 0.5) / h * 180))
    light *= np.cos(lat)[:, None]
    rows = 180 // CELL_DEG
    cols = 360 // CELL_DEG
    cells = light.reshape(rows, h // rows, cols, w // cols).sum(axis=(1, 3))
    cells *= SCALE / cells.max()
    print(json.dumps({
        'cellDeg': CELL_DEG,
        'lights': [[int(round(v)) for v in row] for row in cells],
    }, separators=(',', ':')))


if __name__ == '__main__':
    main()
