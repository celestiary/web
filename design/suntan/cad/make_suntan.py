#!/usr/bin/env python3
"""Suntan concept spacecraft -> STEP (AP214) assembly.

    python make_suntan.py [out.step]        # default: suntan.step beside this file

Units are millimetres; +Z points at the Sun. Writes three files:

    suntan.step        the assembly
    suntan.parts.json  per-part kernel area/volume/mass (validate_conway.mjs
                       checks Conway's tessellation against these)
    suntan.parts.md    the same as a Markdown table (pasted into README.md)

Solids come from OpenCascade through CadQuery; the product structure is
written through XCAF directly rather than cq.Assembly, because cq.Assembly
copies a sub-assembly each time it is added, so four Landers would export as
four PRODUCTs. Here a node is one PRODUCT however often it is placed, and each
placement is one NEXT_ASSEMBLY_USAGE_OCCURRENCE.

Which surfaces are used is dictated by the reader this is for (Conway, the
engine behind Bldrs Share). Measured against it, 2026-11-20:

  * planes, cylinders, cone frustums and a FULL untrimmed sphere tessellate
    to within 1% of the kernel's area and volume;
  * a full torus is dropped ("boundary straddles both branch cuts"), and one
    split into 90 degree patches comes out 25% over in area;
  * a sphere with any trim (a port, a hemisphere, a void shell) loses or
    mangles the spherical face, and a BREP_WITH_VOIDS loses its inner shell;
  * a cone that reaches its apex tessellates ~7% short in volume;
  * a thin cone band of large radius (15 mm wide at r = 650) is triangulated
    with skewed triangles: closed and volume-correct, but 7% over in area.

So everything round except the Instrument core is a LATHE part: a closed
polygon in the (r, z) half-plane revolved 360 degrees, which yields only
planes, cylinders and cone frustums. Keep profiles off the axis except along
edges perpendicular to it (flat caps), or the apex problem comes back.
"""
import json
import math
import os
import sys

import cadquery as cq
from cadquery import Location as Loc
from cadquery import Vector as V
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool
from OCP.XSControl import XSControl_WorkSession

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def T(x=0.0, y=0.0, z=0.0):
    """Translation."""
    return Loc(V(x, y, z))


def R(axis, deg):
    """Rotation about an axis through the origin (right-handed, degrees)."""
    return Loc(V(0, 0, 0), V(*axis), deg)


# --------------------------------------------------------------------------
# Tree model: a Part is a leaf product (one solid), an Asm is an assembly
# product. Both are placed by (child, location, occurrence name) triples.
# --------------------------------------------------------------------------
class Part:
    def __init__(self, name, shape, rgb, material, density, dims):
        self.name = name
        self.shape = shape
        self.rgb = rgb
        self.material = material
        self.density = density  # kg/m3, effective (see README)
        self.dims = dims
        if not shape.isValid():
            raise ValueError(f'{name}: kernel says the solid is invalid')
        if shape.Volume() <= 0:
            raise ValueError(f'{name}: non-positive volume {shape.Volume()}')


class Asm:
    def __init__(self, name):
        self.name = name
        self.children = []

    def add(self, child, loc=None, name=None):
        self.children.append((child, loc or Loc(), name or child.name))
        return self


def centred_box(lx, ly, lz):
    """A box centred on the origin, with NO location on the shape.

    Not cq.Workplane.box(): that returns the solid `moved()` by a location,
    and the STEP writer then fails to match the located shape back to its
    label, so the PRODUCT is written under OpenCascade's default name
    ('Open CASCADE STEP translator 7.9 1.1.4') instead of the part's.
    """
    return cq.Solid.makeBox(lx, ly, lz, V(-lx / 2, -ly / 2, -lz / 2))


def lathe(profile):
    """Revolve a closed (r, z) polygon 360 degrees about Z into one solid."""
    def build(points):
        wire = cq.Wire.makePolygon([V(r, 0, z) for r, z in points], close=True)
        face = cq.Face.makeFromWires(wire)
        axis = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
        return cq.Shape.cast(BRepPrimAPI_MakeRevol(face.wrapped, axis, 2 * math.pi).Shape())
    solid = build(profile)
    if solid.Volume() < 0:
        # The profile's winding decides which way the faces point.
        solid = build(profile[::-1])
    return solid


# --------------------------------------------------------------------------
# Dimensions (mm)
# --------------------------------------------------------------------------
SHIELD_R, SHIELD_T = 1150.0, 115.0            # disc 2300 x 115
TRUSS_H = 600.0
TRUSS_R_TOP, TRUSS_R_BOT, TRUSS_WALL = 1000.0, 540.0, 6.0
BUS_AF, BUS_H = 1000.0, 1300.0                 # across flats, height
Z_SHIELD_BOT = -SHIELD_T                       # -115
Z_BUS_TOP = Z_SHIELD_BOT - TRUSS_H             # -715
Z_BUS_BOT = Z_BUS_TOP - BUS_H                  # -2015
ARRAY_L, ARRAY_W, ARRAY_T, ARRAY_CANT = 1120.0, 690.0, 25.0, 35.0
RAD_W, RAD_H, RAD_T, RAD_STANDOFF = 560.0, 480.0, 20.0, 25.0
FIELDS_R, FIELDS_L, FIELDS_SWEEP = 5.0, 2000.0, 10.0
BOOM_R, BOOM_L = 30.0, 3500.0

HUB_R, HUB_L, HUB_BORE_R = 400.0, 400.0, 82.0
AXLE_R = 80.0
SPOKE_R, SPOKE_L = 50.0, 3000.0
YOKE_T, YOKE_BEAM_H = 200.0, 150.0             # thickness in X, crossbeam depth
YOKE_ARM_IN, YOKE_ARM_OUT, YOKE_HALF_SPAN = 820.0, 920.0, 1120.0

# Lander shells: radii. Each inner shell's OUTER radius is pulled in 2 mm from
# the spec so nested surfaces never coincide (coincident faces of two colours
# z-fight in a cut view); inner radii and the core are exactly the spec's.
GAP = 2.0
ABL_RO, ABL_RI = 600.0, 450.0
HULL_RO, HULL_RI = 450.0 - GAP, 420.0
PLEN_RO, PLEN_RI = 420.0 - GAP, 350.0
CORE_R = 300.0
WINDOW_R, WINDOW_T = 60.0, 40.0
PORT_R = WINDOW_R + 1.0
# The core is a true sphere, but the insulation's inner surface ends in a flat
# pad of radius PORT_R at -Z, which sits closer to the centre than the radius
# it is cut from. Size the insulation's inner radius so that pad, not just the
# spherical part, clears the core by 1 mm or more (kernel check: with 302 the
# core poked 16.7 cm3 through the pad).
INS_RO = 350.0 - GAP
INS_RI = float(math.ceil(math.sqrt((CORE_R + 1.0) ** 2 + PORT_R ** 2)))  # 308
BAND_DEG = 6.0                                 # latitude step of the cone bands
COIL_R, COIL_r = 650.0, 30.0
NOZZLE_L, NOZZLE_R0, NOZZLE_R1, NOZZLE_WALL = 120.0, 20.0, 55.0, 6.0
N_NOZZLES = 6

# The ablator's -Z pole is a flat pad (mirror of the +Z port); the spoke tip
# lands on it, so the lander centre sits this far past the spoke's end.
PAD_Z = math.sqrt(ABL_RO ** 2 - PORT_R ** 2)
LANDER_RC = HUB_R + SPOKE_L + PAD_Z
# Outermost thing on a lander as the wheel turns is a coil, COIL_R + COIL_r
# from its centre. Hub goes far enough aft that the rim clears the yoke beam.
SWEPT_R = LANDER_RC + COIL_R + COIL_r
CLEARANCE = 150.0
HUB_Z = Z_BUS_BOT - YOKE_BEAM_H - CLEARANCE - SWEPT_R
HUB_Z = -math.ceil(-HUB_Z / 50.0) * 50.0       # round aft to 50 mm


def shell_profile(ro, ri):
    """(r, z) polygon of a spherical shell ro/ri as cone bands, with an axial
    port of radius PORT_R at +Z and a flat pad of the same radius at -Z."""
    def arc(rad):
        t0 = math.degrees(math.asin(PORT_R / rad))
        upper = [(PORT_R, math.sqrt(rad * rad - PORT_R * PORT_R))]
        a = BAND_DEG / 2
        while a < 90:
            if a > t0 + 1.5:
                upper.append((rad * math.sin(math.radians(a)), rad * math.cos(math.radians(a))))
            a += BAND_DEG
        # Mirror rather than recompute, so the band straddling the equator has
        # bit-equal radii and revolves to a cylinder, not a 1e-16 cone.
        return upper + [(r, -z) for r, z in reversed(upper)]
    outer = arc(ro)
    inner = arc(ri)[::-1]
    return outer + [(0.0, outer[-1][1]), (0.0, inner[0][1])] + inner


def ring_profile(major, minor):
    """Square section of the same AREA as a round one of radius `minor`,
    centred at r = `major`: the stand-in for a torus.

    Square, not a many-sided polygon: Conway triangulates a thin cone band of
    large radius with skewed triangles (a revolved 12-gon of this size meshes
    7% over in area, an 8-gon 3% over), while the two cylinders and two flat
    annuli of a square section come out exact. Equal area keeps the coil's
    volume, and so its mass, what the torus's would be.
    """
    h = math.sqrt(math.pi) * minor / 2
    return [(major - h, -h), (major + h, -h), (major + h, h), (major - h, h)]


def hga_profile():
    """Mast (r 30 x 220) carrying a 600 dia parabolic dish, 100 deep, 10 thick."""
    def zf(r):
        return 220.0 + r * r / 900.0
    rs = [30.0, 75.0, 120.0, 165.0, 210.0, 255.0, 300.0]
    back = [(r, zf(r) - 10.0) for r in rs]
    front = [(r, zf(r)) for r in reversed(rs)]
    return [(0.0, 0.0), (30.0, 0.0)] + back + front + [(0.0, zf(30.0))]


def build():
    # ---------------- Orbiter (PSP-derived) ----------------
    shield = Part('TPS heat shield',
                  cq.Solid.makeCylinder(SHIELD_R, SHIELD_T, V(0, 0, Z_SHIELD_BOT)),
                  (0.96, 0.96, 0.93), 'carbon-carbon facesheets on carbon foam, alumina white coat', 150,
                  'disc dia 2300 x 115')
    truss = Part('TPS truss',
                 lathe([(TRUSS_R_BOT, Z_BUS_TOP), (TRUSS_R_TOP, Z_SHIELD_BOT),
                        (TRUSS_R_TOP - TRUSS_WALL, Z_SHIELD_BOT), (TRUSS_R_BOT - TRUSS_WALL, Z_BUS_TOP)]),
                 (0.55, 0.56, 0.60), 'Ti-6Al-4V (closed shell standing in for an open truss, 20% solidity)', 886,
                 'cone frustum shell dia 2000 -> 1080 x 600, wall 6')
    bus = Part('Bus',
               cq.Workplane('XY').polygon(6, BUS_AF / math.cos(math.radians(30))).extrude(BUS_H).val()
               .rotate(V(0, 0, 0), V(0, 0, 1), 30).translate(V(0, 0, Z_BUS_BOT)),
               (0.74, 0.75, 0.78), 'aluminium honeycomb bus with avionics and propellant (effective)', 400,
               'hex prism 1000 across flats x 1300')
    array = Part('Solar array', centred_box(ARRAY_L, ARRAY_W, ARRAY_T),
                 (0.07, 0.11, 0.36), 'cells on a water-cooled titanium platen (effective)', 1100,
                 '1120 x 690 x 25')
    radiator = Part('Cooling radiator', centred_box(RAD_T, RAD_W, RAD_H),
                    (0.70, 0.80, 0.88), 'aluminium panel with titanium coolant tubes (effective)', 1000,
                    '560 x 480 x 20')
    hga = Part('High-gain antenna', lathe(hga_profile()),
               (0.90, 0.90, 0.86), 'CFRP reflector and mast', 1600,
               'dish dia 600 x 100 deep, mast dia 60 x 220')
    fields = Part('FIELDS antenna', cq.Solid.makeCylinder(FIELDS_R, FIELDS_L),
                  (0.62, 0.62, 0.68), 'niobium C-103 (modelled solid)', 8850, 'whip dia 10 x 2000')
    boom = Part('Magnetometer boom', cq.Solid.makeCylinder(BOOM_R, BOOM_L),
                (0.28, 0.28, 0.30), 'CFRP tube (modelled solid, 20% solidity)', 320, 'dia 60 x 3500')

    orbiter = Asm('Orbiter')
    orbiter.add(shield).add(truss).add(bus)
    for az, tag in ((0, '+X'), (180, '-X')):
        # Root edge on the bus flat, outer edge canted aft (away from the Sun).
        orbiter.add(array, R(Z, az) * T(BUS_AF / 2 + 40, 0, -1000) * R(Y, ARRAY_CANT) * T(ARRAY_L / 2), f'Solar array {tag}')
    alpha = math.degrees(math.atan((TRUSS_R_TOP - TRUSS_R_BOT) / TRUSS_H))  # cone half-angle from Z
    mid_r = (TRUSS_R_TOP + TRUSS_R_BOT) / 2
    mid_z = (Z_SHIELD_BOT + Z_BUS_TOP) / 2
    off = RAD_STANDOFF + RAD_T / 2
    rad_c = (mid_r + off * math.cos(math.radians(alpha)), mid_z - off * math.sin(math.radians(alpha)))
    for i, az in enumerate((60, 120, 240, 300)):
        orbiter.add(radiator, R(Z, az) * T(rad_c[0], 0, rad_c[1]) * R(Y, alpha), f'Cooling radiator {i + 1}')
    orbiter.add(hga, R(Z, 240) * T(BUS_AF / 2, 0, -1500) * R(Y, 90))
    z_f = Z_SHIELD_BOT - 45.0
    r_f = TRUSS_R_TOP - 45.0 * (TRUSS_R_TOP - TRUSS_R_BOT) / TRUSS_H + 5.0
    for i, az in enumerate((45, 135, 225, 315)):
        orbiter.add(fields, R(Z, az) * T(r_f, 0, z_f) * R(Y, 90 + FIELDS_SWEEP), f'FIELDS antenna V{i + 1}')
    # The bus's aft face is inside the wheel's swept volume, so the boom hangs
    # from the yoke crossbeam's -Y end, outboard of the yoke arm.
    boom_y = -(YOKE_ARM_OUT + 100.0 + BOOM_R)
    orbiter.add(boom, T(0, boom_y, Z_BUS_BOT - YOKE_BEAM_H - BOOM_L))

    # ---------------- Lander (local +Z = window axis, -Z = spoke) ----------------
    ablator = Part('Ablator shell', lathe(shell_profile(ABL_RO, ABL_RI)),
                   (0.13, 0.11, 0.10), 'carbon-phenolic, sacrificial', 1450, 'sphere dia 1200 / 900')
    hull = Part('HfCN hull', lathe(shell_profile(HULL_RO, HULL_RI)),
                (0.72, 0.72, 0.76), 'hafnium carbonitride', 12700, 'sphere dia 896 / 840')
    plenum = Part('Coolant plenum', lathe(shell_profile(PLEN_RO, PLEN_RI)),
                  (0.20, 0.45, 0.85), 'refractory lattice flooded with coolant (effective)', 1500,
                  'sphere dia 836 / 700')
    insulation = Part('Insulation', lathe(shell_profile(INS_RO, INS_RI)),
                      (0.93, 0.89, 0.72), 'zirconia fibre / aerogel', 200,
                      f'sphere dia {2 * INS_RO:.0f} / {2 * INS_RI:.0f}')
    core = Part('Instrument core', cq.Solid.makeSphere(CORE_R, angleDegrees1=-90, angleDegrees2=90),
                (0.16, 0.52, 0.32), 'instruments and avionics (effective)', 1000, 'solid sphere dia 600')
    window = Part('Diamond window', cq.Solid.makeCylinder(WINDOW_R, WINDOW_T),
                  (0.74, 0.90, 1.00), 'CVD diamond', 3515, 'disc dia 120 x 40')
    coil = Part('Magnet coil', lathe(ring_profile(COIL_R, COIL_r)),
                (0.85, 0.47, 0.16), 'copper (modelled solid)', 8960,
                'ring major dia 1300, square section 53.2 x 53.2 (area of a dia 60 round)')
    nozzle = Part('Vent nozzle',
                  lathe([(NOZZLE_R0 - NOZZLE_WALL, 0.0), (NOZZLE_R0, 0.0),
                         (NOZZLE_R1, NOZZLE_L), (NOZZLE_R1 - NOZZLE_WALL, NOZZLE_L)]),
                  (0.50, 0.50, 0.56), 'tungsten', 19300, 'hollow cone dia 40 -> 110 x 120, wall 6')

    lander = Asm('Lander')
    lander.add(ablator).add(hull).add(plenum).add(insulation).add(core)
    # Window sits in the hull's port, its outer face where the hull meets the
    # port wall; the ablator's port above it is an open light well.
    lander.add(window, T(0, 0, math.sqrt(HULL_RO ** 2 - PORT_R ** 2) - WINDOW_T))
    # Three mutually orthogonal coil axes, all at the same angle to local Z
    # (the cube diagonal), so neither the port (+Z) nor the spoke (-Z) nor the
    # equatorial vents meet a coil. They do cross EACH OTHER at six nodes.
    tilt = math.degrees(math.acos(1 / math.sqrt(3)))
    for i, phi in enumerate((0, 120, 240)):
        lander.add(coil, R(Z, phi) * R(Y, tilt), f'Magnet coil {"ABC"[i]}')
    # Vents on the equator, midway between the six places coils cross it.
    r_eq = ABL_RO * math.sin(math.radians(90 - BAND_DEG / 2))  # the equatorial band is this cylinder
    for i in range(N_NOZZLES):
        lander.add(nozzle, R(Z, i * 360.0 / N_NOZZLES) * T(r_eq) * R(Y, 90), f'Vent nozzle {i + 1}')

    # ---------------- Sling wheel (origin at the hub centre, axle along Y) ----------------
    top = Z_BUS_BOT - HUB_Z                    # crossbeam's top face, in wheel coordinates
    bot = -150.0
    u = [(-YOKE_HALF_SPAN, top), (YOKE_HALF_SPAN, top), (YOKE_HALF_SPAN, top - YOKE_BEAM_H),
         (YOKE_ARM_OUT, top - YOKE_BEAM_H), (YOKE_ARM_OUT, bot), (YOKE_ARM_IN, bot),
         (YOKE_ARM_IN, top - YOKE_BEAM_H), (-YOKE_ARM_IN, top - YOKE_BEAM_H), (-YOKE_ARM_IN, bot),
         (-YOKE_ARM_OUT, bot), (-YOKE_ARM_OUT, top - YOKE_BEAM_H), (-YOKE_HALF_SPAN, top - YOKE_BEAM_H)]
    yoke = Part('Yoke', cq.Workplane('YZ').polyline(u).close().extrude(YOKE_T).val().translate(V(-YOKE_T / 2, 0, 0)),
                (0.45, 0.50, 0.56), 'Ti-6Al-4V box beam (10% solidity)', 443,
                f'U frame {2 * YOKE_HALF_SPAN:.0f} wide x {top - bot:.0f} long, 200 deep')
    axle = Part('Axle', cq.Solid.makeCylinder(AXLE_R, 2 * YOKE_ARM_IN, V(0, 0, -YOKE_ARM_IN)),
                (0.72, 0.72, 0.74), 'Ti-6Al-4V tube (25% solidity)', 1107, f'dia 160 x {2 * YOKE_ARM_IN:.0f}')
    hub = Part('Hub',
               cq.Workplane('XY').circle(HUB_R).circle(HUB_BORE_R).extrude(HUB_L).val().translate(V(0, 0, -HUB_L / 2)),
               (0.34, 0.36, 0.42), 'aluminium (15% solidity)', 405, 'cylinder dia 800 x 400, bore dia 164')
    spoke = Part('Spoke', cq.Solid.makeCylinder(SPOKE_R, SPOKE_L),
                 (0.52, 0.52, 0.55), 'CFRP tube (20% solidity)', 320, 'dia 100 x 3000')

    wheel = Asm('Sling wheel')
    wheel.add(yoke).add(axle, R(X, 90)).add(hub, R(X, 90))
    for i, phi in enumerate((0, 90, 180, 270)):
        # Local Z -> the radial direction at angle phi in the XZ wheel plane.
        radial = R(Y, 90 - phi)
        wheel.add(spoke, radial * T(0, 0, HUB_R), f'Spoke {i + 1}')
    for i, phi in enumerate((0, 90, 180, 270)):
        wheel.add(lander, R(Y, 90 - phi) * T(0, 0, LANDER_RC), f'Lander {i + 1}')

    root = Asm('Suntan')
    root.add(orbiter).add(wheel, T(0, 0, HUB_Z))
    return root


# --------------------------------------------------------------------------
# STEP export through XCAF
# --------------------------------------------------------------------------
def export_step(root, path, pcurves):
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString('XmlXCAF'))
    app.InitDocument(doc)
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    ctool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    labels = {}

    def label_of(node):
        if id(node) in labels:
            return labels[id(node)]
        lab = tool.NewShape()
        TDataStd_Name.Set_s(lab, TCollection_ExtendedString(node.name))
        labels[id(node)] = lab
        if isinstance(node, Part):
            tool.SetShape(lab, node.shape.wrapped)
            # cq.Color does the sRGB -> linear step OpenCascade expects, so the
            # COLOUR_RGB in the file reads back as the numbers given here.
            ctool.SetColor(lab, cq.Color(*node.rgb).wrapped, XCAFDoc_ColorType.XCAFDoc_ColorSurf)
        else:
            for child, loc, name in node.children:
                comp = tool.AddComponent(lab, label_of(child), loc.wrapped)
                TDataStd_Name.Set_s(comp, TCollection_ExtendedString(name))
        return lab

    label_of(root)
    tool.UpdateAssemblies()
    writer = STEPCAFControl_Writer(XSControl_WorkSession(), False)
    writer.SetColorMode(True)
    writer.SetNameMode(True)
    Interface_Static.SetCVal_s('write.step.schema', 'AP214IS')
    Interface_Static.SetIVal_s('write.surfacecurve.mode', 1 if pcurves else 0)
    writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs)
    if writer.Write(path) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f'STEP write failed: {path}')


def tally(root):
    """Leaf parts in tree order with how many times each is placed in total."""
    counts, order = {}, []

    def walk(node, mult):
        if isinstance(node, Part):
            if id(node) not in counts:
                counts[id(node)] = 0
                order.append(node)
            counts[id(node)] += mult
            return
        for child, _, _ in node.children:
            walk(child, mult)
    walk(root, 1)
    return [(p, counts[id(p)]) for p in order]


def tree_text(node, depth=0, lines=None):
    lines = [] if lines is None else lines
    if depth == 0:
        lines.append(node.name)
    groups = []
    for child, _, _ in node.children:
        if groups and groups[-1][0] is child:
            groups[-1][1] += 1
        else:
            groups.append([child, 1])
    for child, n in groups:
        lines.append(f"{'  ' * (depth + 1)}{child.name}{f' x{n}' if n > 1 else ''}")
        if isinstance(child, Asm):
            tree_text(child, depth + 1, lines)
    return lines


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = args[0] if args else os.path.join(here, 'suntan.step')
    root = build()
    export_step(root, out, pcurves='--no-pcurves' not in sys.argv)
    parts = []
    for p, n in tally(root):
        vol, area = p.shape.Volume(), p.shape.Area()
        mass = vol / 1e9 * p.density
        parts.append({'name': p.name, 'count': n, 'dimensions_mm': p.dims, 'material': p.material,
                      'density_kg_m3': p.density, 'volume_mm3': vol, 'area_mm2': area,
                      'mass_kg_each': mass, 'mass_kg_total': mass * n, 'rgb': p.rgb})
    stem = os.path.splitext(out)[0]
    with open(stem + '.parts.json', 'w') as f:
        json.dump({'units': 'mm', 'hub_z_mm': HUB_Z, 'lander_centre_radius_mm': LANDER_RC,
                   'tree': tree_text(root), 'parts': parts}, f, indent=1)
    rows = ['| Part | Count | Key dimensions (mm) | Intended material | Density (kg/m3) | Volume each (m3) | Mass each (kg) | Mass total (kg) |',
            '|---|---:|---|---|---:|---:|---:|---:|']
    for q in parts:
        rows.append(f"| {q['name']} | {q['count']} | {q['dimensions_mm']} | {q['material']} | {q['density_kg_m3']} | "
                    f"{q['volume_mm3'] / 1e9:.4g} | {q['mass_kg_each']:.1f} | {q['mass_kg_total']:.1f} |")
    total = sum(q['mass_kg_total'] for q in parts)
    rows.append(f'| **Total** | {sum(q["count"] for q in parts)} | | | | | | **{total:.0f}** |')
    with open(stem + '.parts.md', 'w') as f:
        f.write('\n'.join(rows) + '\n')
    print('\n'.join(tree_text(root)))
    print(f'hub z = {HUB_Z:.0f} mm, lander centre radius = {LANDER_RC:.1f} mm, total mass = {total:.0f} kg')
    print(f'wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()
