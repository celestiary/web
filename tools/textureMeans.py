#!/usr/bin/env python3
"""Each planet's and moon's colour map's mean, in linear light, for the colour
a surface shows while its map loads (js/scene/textureMeans.json; Planet.js
nearShape; js/scene/Planet.md, "While the maps load"), and for the far
point's hand-off and the albedo calibration (Planet.md, "Albedo").

The mean is over the sphere, each texel weighted by its area (cos lat), per
channel, of the values a shader samples (js/scene/HDR.md, "Colour spaces"):
for a picture, sRGB-encoded, each texel decoded first (the mean of the
decoded values, which isn't the decode of the mean); for a map whose
descriptor says `texture_encoding: "linear"` (the Moon's linear stretch of
I/F), the stored value over 255.  So a surface drawn in it is lit to the
light the textured one gives, on average.

Usage: tools/textureMeans.py > js/scene/textureMeans.json
Run from the repository root.  Needs Pillow and NumPy.  A body whose map
follows the month (Earth's texture_monthly) takes January's.
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def texture_path(props):
    name = props['name']
    monthly = props.get('texture_monthly')
    if monthly:
        return f'public/textures/{monthly.replace("{MM}", "01")}.jpg'
    return f'public/textures/{props.get("texture_dir", "")}{name}.jpg'


def srgb_decode(v):
    """IEC 61966-2-1's decode, as the GPU's SRGB8_ALPHA8 sampling does."""
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def mean_rgb(path, encoding='srgb'):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float) / 255
    if encoding != 'linear':
        im = srgb_decode(im)
    h = im.shape[0]
    lat = np.radians(90 - ((np.arange(h) + 0.5) / h * 180))
    weight = np.cos(lat)[:, None]
    return [round(float((im[:, :, c] * weight).sum() / (weight.sum() * im.shape[1])), 4) for c in range(3)]


def main():
    means = {}
    # Each body's descriptor, in its directory (js/bodyDirs.json, yarn bodies).
    with open('js/bodyDirs.json') as f:
        dirs = json.load(f)
    for path in sorted(f'public/data/{d}/index.json' for d in dirs.values()):
        try:
            with open(path) as f:
                props = json.load(f)
        except ValueError:
            continue
        if not isinstance(props, dict) or props.get('type') not in ('planet', 'moon') or 'name' not in props:
            continue
        tex = texture_path(props)
        if os.path.exists(tex) and props['name'] not in means:
            means[props['name']] = mean_rgb(tex, props.get('texture_encoding', 'srgb'))
    json.dump(dict(sorted(means.items())), sys.stdout, indent=2)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
