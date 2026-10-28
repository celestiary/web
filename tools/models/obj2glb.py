#!/usr/bin/env python3
"""A Wavefront OBJ to a binary glTF: one node per OBJ object, its polygons
triangulated (a fan), positions and normals (the file's where a face has
them, else the face's own), a material per `usemtl` from a palette given
on the command line as name=r,g,b,metal,rough.  No textures.  For
NOIRLab's Rubin telescope (model3d004.obj, no .mtl served).

  obj2glb.py in.obj out.glb [--scale 0.01] [--mat name=r,g,b,m,r ...]
             [--group name=regex ...]

A `--group` gathers the objects whose names match under a node of that
name (the first group that matches wins; objects no group matches go
under `rest`), so an app can turn a part of the model: the telescope's
azimuth and elevation structures (js/scene/rubin/Rubin.md).  Run by
tools/models/build.sh; dependency-free.
"""
import json
import math
import re
import struct
import sys


def main():
    args = sys.argv[1:]
    src, dst = args[0], args[1]
    scale = 1.0
    palette = {}
    groups = []
    i = 2
    while i < len(args):
        if args[i] == '--scale':
            scale = float(args[i + 1])
            i += 2
        elif args[i] == '--mat':
            name, vals = args[i + 1].split('=')
            palette[name] = [float(x) for x in vals.split(',')]
            i += 2
        elif args[i] == '--group':
            name, pattern = args[i + 1].split('=', 1)
            groups.append((name, re.compile(pattern)))
            i += 2
        else:
            raise SystemExit(f'unknown arg {args[i]}')
    verts, norms = [], []
    objects = []  # [name, {material: [tri...]}]
    cur = None
    mat = 'default'
    for line in open(src, encoding='utf-8', errors='replace'):
        if line.startswith('v '):
            p = line.split()
            verts.append((float(p[1]) * scale, float(p[2]) * scale, float(p[3]) * scale))
        elif line.startswith('vn '):
            p = line.split()
            norms.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith('o ') or line.startswith('g '):
            cur = [line[2:].strip(), {}]
            objects.append(cur)
        elif line.startswith('usemtl'):
            mat = line.split(None, 1)[1].strip() if len(line.split()) > 1 else 'default'
        elif line.startswith('f '):
            if cur is None:
                cur = ['mesh', {}]
                objects.append(cur)
            corners = []
            for tok in line.split()[1:]:
                parts = tok.split('/')
                vi = int(parts[0])
                vi = vi - 1 if vi > 0 else len(verts) + vi
                ni = None
                if len(parts) > 2 and parts[2]:
                    ni = int(parts[2])
                    ni = ni - 1 if ni > 0 else len(norms) + ni
                corners.append((vi, ni))
            tris = cur[1].setdefault(mat, [])
            for k in range(1, len(corners) - 1):
                tris.append((corners[0], corners[k], corners[k + 1]))

    def face_normal(a, b, c):
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        return (nx / l, ny / l, nz / l)

    bin_parts = []
    buffer_views, accessors, meshes, nodes, materials = [], [], [], [], []
    mat_index = {}

    def material_for(name):
        if name not in mat_index:
            r, g, b, m, ro = palette.get(name, palette.get('default', [0.7, 0.7, 0.7, 0.2, 0.7]))
            mat_index[name] = len(materials)
            materials.append({'name': name, 'pbrMetallicRoughness': {
                'baseColorFactor': [r, g, b, 1], 'metallicFactor': m, 'roughnessFactor': ro}})
        return mat_index[name]

    offset = 0

    def add_view(data, target):
        nonlocal offset
        pad = (-len(data)) % 4
        data = data + b'\0' * pad
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data) - pad, 'target': target})
        bin_parts.append(data)
        offset += len(data)
        return len(buffer_views) - 1

    total_tris = 0
    for name, by_mat in objects:
        primitives = []
        for mname, tris in by_mat.items():
            positions, normals, indices = [], [], []
            index_of = {}
            for tri in tris:
                pts = [verts[c[0]] for c in tri]
                fn = face_normal(*pts)
                for (vi, ni) in tri:
                    n = norms[ni] if ni is not None and ni < len(norms) else fn
                    key = (vi, n)
                    if key not in index_of:
                        index_of[key] = len(positions)
                        positions.append(verts[vi])
                        normals.append(n)
                    indices.append(index_of[key])
            if not indices:
                continue
            total_tris += len(tris)
            pos_bytes = b''.join(struct.pack('<3f', *p) for p in positions)
            nrm_bytes = b''.join(struct.pack('<3f', *n) for n in normals)
            idx_bytes = b''.join(struct.pack('<I', k) for k in indices)
            mins = [min(p[k] for p in positions) for k in range(3)]
            maxs = [max(p[k] for p in positions) for k in range(3)]
            pv = add_view(pos_bytes, 34962)
            nv = add_view(nrm_bytes, 34962)
            iv = add_view(idx_bytes, 34963)
            accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(positions), 'type': 'VEC3', 'min': mins, 'max': maxs})
            accessors.append({'bufferView': nv, 'componentType': 5126, 'count': len(normals), 'type': 'VEC3'})
            accessors.append({'bufferView': iv, 'componentType': 5125, 'count': len(indices), 'type': 'SCALAR'})
            a = len(accessors)
            primitives.append({'attributes': {'POSITION': a - 3, 'NORMAL': a - 2}, 'indices': a - 1, 'material': material_for(mname)})
        if not primitives:
            continue
        meshes.append({'name': name, 'primitives': primitives})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})

    roots = list(range(len(nodes)))
    if groups:
        members = {name: [] for name, _ in groups}
        members['rest'] = []
        for k, node in enumerate(nodes):
            group = next((name for name, rx in groups if rx.search(node['name'])), 'rest')
            members[group].append(k)
        roots = []
        for name, kids in members.items():
            if kids:
                nodes.append({'name': name, 'children': kids})
                roots.append(len(nodes) - 1)
                print(f'  {name}: {len(kids)} parts')
    gltf = {
        'asset': {'version': '2.0', 'generator': 'celestiary obj2glb.py'},
        'scene': 0,
        'scenes': [{'nodes': roots}],
        'nodes': nodes, 'meshes': meshes, 'materials': materials,
        'accessors': accessors, 'bufferViews': buffer_views,
        'buffers': [{'byteLength': offset}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binary = b''.join(bin_parts)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON'))
        f.write(js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\0'))
        f.write(binary)
    print(f'{dst}: {len(nodes)} nodes, {total_tris} triangles, {len(materials)} materials, {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
