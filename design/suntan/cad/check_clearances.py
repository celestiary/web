#!/usr/bin/env python3
"""Interference check for the Suntan assembly, in the B-rep kernel.

    python check_clearances.py

Places every leaf part where the assembly puts it, and for each pair whose
bounding boxes overlap asks OpenCascade for the minimum distance. Touching or
overlapping pairs (distance 0) get their common volume computed. Pairs inside
Landers 2-4 are skipped: they repeat Lander 1 exactly.

One overlap is by design and reported as EXPECTED rather than failed: three
equal rings on mutually orthogonal planes about one centre cannot avoid each
other, so the Magnet coils pass through one another at six nodes.
"""
import itertools
import sys
import time

# Importing the generator as a module would otherwise leave a __pycache__
# directory in the study's working tree.
sys.dont_write_bytecode = True

from cadquery import Location as Loc
from OCP.BRepExtrema import BRepExtrema_DistShapeShape

import make_suntan as m

TOUCH = 1e-6       # mm; below this the pair is in contact
REPORT_BELOW = 30  # mm; list every pair closer than this


def flatten(node, loc, path, out):
    if isinstance(node, m.Part):
        out.append(('/'.join(path), node, node.shape.moved(loc)))
        return
    for child, cloc, name in node.children:
        flatten(child, loc * cloc, path + [name], out)


def main():
    leaves = []
    flatten(m.build(), Loc(), [], leaves)
    boxes = [s.BoundingBox() for _, _, s in leaves]

    def overlap(a, b):
        return (a.xmin <= b.xmax and b.xmin <= a.xmax and a.ymin <= b.ymax and b.ymin <= a.ymax and
                a.zmin <= b.zmax and b.zmin <= a.zmax)

    def lander_of(path):
        return next((p for p in path.split('/') if p.startswith('Lander ')), None)

    t0 = time.time()
    checked = contacts = overlaps = expected = 0
    for i, j in itertools.combinations(range(len(leaves)), 2):
        (pa, _, sa), (pb, _, sb) = leaves[i], leaves[j]
        la, lb = lander_of(pa), lander_of(pb)
        if la and la == lb and la != 'Lander 1':
            continue
        if not overlap(boxes[i], boxes[j]):
            continue
        checked += 1
        d = BRepExtrema_DistShapeShape(sa.wrapped, sb.wrapped)
        dist = d.Value() if d.IsDone() else float('nan')
        if dist < TOUCH:
            contacts += 1
            try:
                vol = sa.intersect(sb).Volume()
            except Exception as e:  # a failed boolean is itself worth seeing
                vol = float('nan')
                print(f'  boolean failed: {e}')
            by_design = 'Magnet coil' in pa and 'Magnet coil' in pb
            if vol > 1.0 and by_design:
                expected += 1
            elif vol > 1.0:
                overlaps += 1
            tag = 'touch  ' if vol <= 1.0 else ('EXPECTED' if by_design else 'OVERLAP')
            print(f'{tag} {pa}  <->  {pb}: common volume {vol:.1f} mm3', flush=True)
        elif dist < REPORT_BELOW:
            print(f'close   {pa}  <->  {pb}: {dist:.2f} mm', flush=True)
    print(f'{len(leaves)} placed parts, {checked} pairs with overlapping boxes checked in {time.time() - t0:.0f} s: '
          f'{contacts} in contact, {expected} interpenetrating by design (coil nodes), '
          f'{overlaps} interpenetrating by mistake')
    return 1 if overlaps else 0


if __name__ == '__main__':
    sys.exit(main())
