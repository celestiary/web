#!/usr/bin/env python3
"""Each planet's and moon's colour map's mean stored value, for the colour a
surface shows while its map loads (js/scene/textureMeans.json; Planet.js
nearShape; js/scene/Planet.md, "While the map loads").

The mean is over the sphere, each texel weighted by its area (cos lat), in
stored values (the 8-bit value over 255, which celestiary lights as linear:
js/scene/HDR.md, "Colour spaces"), per channel.  So a surface drawn in it
is lit to the light the textured one gives, on average.

Usage: tools/textureMeans.py > js/scene/textureMeans.json
Run from the repository root.  Needs Pillow and NumPy.  A body whose map
follows the month (Earth's texture_monthly) takes January's.
"""
import glob
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


def mean_rgb(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float) / 255
    h = im.shape[0]
    lat = np.radians(90 - ((np.arange(h) + 0.5) / h * 180))
    weight = np.cos(lat)[:, None]
    return [round(float((im[:, :, c] * weight).sum() / (weight.sum() * im.shape[1])), 4) for c in range(3)]


def main():
    means = {}
    for path in sorted(glob.glob('public/data/*.json')):
        try:
            with open(path) as f:
                props = json.load(f)
        except ValueError:
            continue
        if not isinstance(props, dict) or props.get('type') not in ('planet', 'moon') or 'name' not in props:
            continue
        tex = texture_path(props)
        if os.path.exists(tex) and props['name'] not in means:
            means[props['name']] = mean_rgb(tex)
    json.dump(dict(sorted(means.items())), sys.stdout, indent=2)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
