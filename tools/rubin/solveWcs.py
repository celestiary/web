"""Solve the placement (a TAN WCS) of NOIRLab's noirlab2626d on the sky.

Rubin.md, "The imagery".  The press composite has no FITS header, so this
fits one: bright star centroids in a downsampled copy of the image, matched
to Gaia DR3 from a guess at the page's centre, 0.2"/px and a rotation found
by search (both parities), then a least-squares TAN fit (CRVAL, CRPIX, CD).

  python3 -I tools/rubin/solveWcs.py <image.png> <factor> <gaia.csv> <out.json> [fixture.json]

<image.png>: the image reduced by <factor> (an integer) from 33075 x 22050;
<gaia.csv>: source_id,ra,dec,phot_g_mean_mag from the archive's cone round
the centre (the query is in Rubin.md).  Writes the WCS in full-resolution
pixels (0-based, x right, y down, a pixel's centre at integer + 0.5), and
the matched stars as the test's fixture.
"""
import json
import math
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
FULL_W, FULL_H = 33075, 22050
RA0, DEC0 = 274.264, -42.777
SCALE_ARCSEC = 0.2


def tan_project(ra, dec, ra0, dec0):
    """Gnomonic: (ra, dec) degrees to standard coordinates (xi east, eta north), degrees."""
    ra, dec = np.radians(ra), np.radians(dec)
    a0, d0 = math.radians(ra0), math.radians(dec0)
    cosc = np.sin(d0) * np.sin(dec) + np.cos(d0) * np.cos(dec) * np.cos(ra - a0)
    xi = np.cos(dec) * np.sin(ra - a0) / cosc
    eta = (np.cos(d0) * np.sin(dec) - np.sin(d0) * np.cos(dec) * np.cos(ra - a0)) / cosc
    return np.degrees(xi), np.degrees(eta)


def detect(path, factor, n=600):
    """The n brightest star centroids, in full-resolution pixels, with their 5x5 flux."""
    img = np.asarray(Image.open(path).convert('L'), dtype=np.float32)
    h, w = img.shape
    # Background: a median by 64 px blocks.
    b = 64
    bh, bw = h // b, w // b
    blocks = img[:bh * b, :bw * b].reshape(bh, b, bw, b).transpose(0, 2, 1, 3).reshape(bh, bw, -1)
    bg = np.kron(np.median(blocks, axis=2), np.ones((b, b)))
    bgf = np.full_like(img, float(np.median(bg)))
    bgf[:bh * b, :bw * b] = bg
    s = np.clip(img - bgf, 0, None)
    # Flux in a 5x5 box, by an integral image.
    r = 2
    ii = np.pad(s, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    box = np.zeros_like(s)
    box[r:h - r, r:w - r] = (ii[2 * r + 1:, 2 * r + 1:] - ii[:-2 * r - 1, 2 * r + 1:]
                             - ii[2 * r + 1:, :-2 * r - 1] + ii[:-2 * r - 1, :-2 * r - 1])
    # Local maxima over 11x11.
    m = box.copy()
    for dy in range(-5, 6):
        for dx in range(-5, 6):
            if dx or dy:
                m = np.maximum(m, np.roll(np.roll(box, dy, 0), dx, 1))
    peaks = (box == m) & (box > 0)
    peaks[:12, :] = False
    peaks[-12:, :] = False
    peaks[:, :12] = False
    peaks[:, -12:] = False
    ys, xs = np.nonzero(peaks)
    order = np.argsort(-box[ys, xs])[:n]
    gy, gx = np.mgrid[-3:4, -3:4]
    out = []
    for y, x in zip(ys[order], xs[order]):
        win = s[y - 3:y + 4, x - 3:x + 4]
        t = win.sum()
        cx, cy = x + (gx * win).sum() / t, y + (gy * win).sum() / t
        # A reduced pixel's centre, in full-resolution pixels.
        out.append(((cx + 0.5) * factor, (cy + 0.5) * factor, float(box[y, x])))
    return np.array(out)


def guess_pixels(xi, eta, theta, parity):
    """Standard coordinates to full-res pixels for a rotation and parity."""
    s = SCALE_ARCSEC / 3600
    # Parity +1: north up, east left (x = -xi, y down = -eta).
    u, v = -xi * parity, -eta
    c, sn = math.cos(theta), math.sin(theta)
    x = (c * u - sn * v) / s + FULL_W / 2
    y = (sn * u + c * v) / s + FULL_H / 2
    return x, y


def nearest(ax, ay, bx, by):
    d2 = (ax[:, None] - bx[None, :]) ** 2 + (ay[:, None] - by[None, :]) ** 2
    j = np.argmin(d2, axis=1)
    return j, np.sqrt(d2[np.arange(len(ax)), j])


def fit(px, py, ra, dec, crval):
    """Least squares: standard coordinates about crval = CD (pixel - crpix)."""
    xi, eta = tan_project(ra, dec, *crval)
    a = np.column_stack([px, py, np.ones_like(px)])
    cx = np.linalg.lstsq(a, xi, rcond=None)[0]
    cy = np.linalg.lstsq(a, eta, rcond=None)[0]
    cd = np.array([[cx[0], cx[1]], [cy[0], cy[1]]])
    crpix = np.linalg.solve(cd, -np.array([cx[2], cy[2]]))
    return cd, crpix


def pix_to_world(cd, crpix, crval, x, y):
    xi, eta = np.radians(cd @ np.array([x - crpix[0], y - crpix[1]]))
    a0, d0 = math.radians(crval[0]), math.radians(crval[1])
    den = math.cos(d0) - eta * math.sin(d0)
    ra = a0 + math.atan2(xi, den)
    dec = math.atan2(math.sin(d0) + eta * math.cos(d0), math.hypot(xi, den))
    return math.degrees(ra) % 360, math.degrees(dec)


def world_to_pix(cd, crpix, crval, ra, dec):
    xi, eta = tan_project(ra, dec, *crval)
    p = np.linalg.inv(cd) @ np.vstack([xi, eta])
    return p[0] + crpix[0], p[1] + crpix[1]


def main():
    path, factor, gaia_path, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    fixture_path = sys.argv[5] if len(sys.argv) > 5 else None
    det = detect(path, factor)
    g = np.genfromtxt(gaia_path, delimiter=',', names=True, dtype=None, encoding='utf-8')
    g = g[np.argsort(g['phot_g_mean_mag'])]
    gra, gdec, gmag, gid = g['ra'], g['dec'], g['phot_g_mean_mag'], g['source_id']
    xi, eta = tan_project(gra, gdec, RA0, DEC0)
    dx, dy = det[:300, 0], det[:300, 1]
    best = None
    for parity in (1, -1):
        for k in range(720):
            theta = math.radians(k * 0.5)
            gx, gy = guess_pixels(xi[:500], eta[:500], theta, parity)
            inside = (gx > 0) & (gx < FULL_W) & (gy > 0) & (gy < FULL_H)
            if inside.sum() < 20:
                continue
            d = nearest(dx, dy, gx[inside], gy[inside])[1]
            score = int((d < 60).sum())
            if best is None or score > best[0]:
                best = (score, theta, parity)
    score, theta, parity = best
    print(f'search: {score} of {len(dx)} within 60 px at rotation {math.degrees(theta):.1f} deg, parity {parity}')
    gx, gy = guess_pixels(xi, eta, theta, parity)
    crval = (RA0, DEC0)
    tol = 60.0
    for it in range(10):
        j, d = nearest(det[:, 0], det[:, 1], gx, gy)
        ok = d < tol
        cd, crpix = fit(det[ok, 0], det[ok, 1], gra[j[ok]], gdec[j[ok]], crval)
        # Re-centre the tangent point on the image's centre, and fit again.
        crval = pix_to_world(cd, crpix, crval, FULL_W / 2, FULL_H / 2)
        cd, crpix = fit(det[ok, 0], det[ok, 1], gra[j[ok]], gdec[j[ok]], crval)
        gx, gy = world_to_pix(cd, crpix, crval, gra, gdec)
        r = nearest(det[:, 0], det[:, 1], gx, gy)[1][ok]
        rms = math.sqrt((r ** 2).mean())
        scale = 3600 * math.sqrt(abs(np.linalg.det(cd)))
        print(f'iter {it}: {ok.sum()} stars, tol {tol:.0f} px, rms {rms:.2f} px = {rms * scale:.2f}"')
        tol = max(3 * rms, 4.0)
    j, d = nearest(det[:, 0], det[:, 1], gx, gy)
    ok = d < tol
    scale = 3600 * math.sqrt(abs(np.linalg.det(cd)))
    rms_arcsec = float(math.sqrt((d[ok] ** 2).mean()) * scale)
    wcs = {
        'ctype': ['RA---TAN', 'DEC--TAN'],
        'crval': [float(crval[0]), float(crval[1])],
        'crpix': [float(crpix[0]), float(crpix[1])],
        'cd': [[float(v) for v in row] for row in cd],
        'pixels': '0-based, x right, y down, a pixel\'s centre at integer + 0.5, at full resolution',
        'width': FULL_W,
        'height': FULL_H,
        'scaleArcsec': scale,
        'fit': {'stars': int(ok.sum()), 'rmsArcsec': round(rms_arcsec, 3), 'catalogue': 'Gaia DR3, G < 12.5',
                'detectedAt': f'1/{factor} resolution', 'tool': 'tools/rubin/solveWcs.py'},
    }
    print(json.dumps(wcs, indent=1))
    with open(out_path, 'w') as f:
        json.dump(wcs, f, indent=1)
        f.write('\n')
    if fixture_path:
        stars = [{'gaia': str(gid[j[i]]), 'ra': round(float(gra[j[i]]), 7), 'dec': round(float(gdec[j[i]]), 7),
                  'g': round(float(gmag[j[i]]), 2), 'x': round(float(det[i, 0]), 1), 'y': round(float(det[i, 1]), 1)}
                 for i in np.nonzero(ok)[0]]
        with open(fixture_path, 'w') as f:
            json.dump({'source': 'tools/rubin/solveWcs.py: noirlab2626d against Gaia DR3', 'stars': stars}, f)
            f.write('\n')


if __name__ == '__main__':
    main()
