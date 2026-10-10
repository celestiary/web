# The Milky Way: structure and integrated light

[#99](https://github.com/celestiary/web/issues/99) (rescoped), in the
[galaxy plan](../../ROADMAP.md#the-galaxy-plan).  From outside, a galaxy's
look is the unresolved light of its billions of stars.  The 60k-point cloud
this replaces carried the arms' bright points but almost none of that light:
at physical exposure it showed faint arms round a small bar, and the meter
needed a hand.  The galaxy is now a luminosity density and a dust density
from published structural models, carrying the Milky Way's luminosity in
exposure units.  It is ray-marched through the volume, so one pass gives
three views: the face of a barred spiral from outside, the edge-on disc and
its dust lane, and the band across the sky from inside.

Code: `galaxyModel.js` (the model, its normalisation, the JS march and the
GLSL), `MilkyWay.js` (the pass), `exposure.js` `galaxyGain` (the meter).

**One model, many galaxies.**  Since #221 the model is any disc galaxy's:
every constant below is a field of a *spec*, and the Milky Way is the spec
`MILKY_WAY` (the constants are still exported under their names).  What
only the Milky Way has, its warp and flare, the named clouds, the Local
Bubble and the share the star catalogue resolves, is the spec's, off for
the others; SPARC's 175 galaxies are specs built from their published
parameters, drawn by one uniform-driven program ([Galaxies.md](Galaxies.md)).
The refactor left the Milky Way byte for byte as it was: its generated
GLSL, its map's bytes, its normalisation and its light along sample rays
compare equal before and after, and the band from the Sun renders
identically to `main`'s.  From far outside it, beyond a patch's size, it is
also a point in the galaxies' far pass, carrying its 2.5e10 L☉
([Galaxies.md, levels of detail](Galaxies.md#levels-of-detail)).

## The frame

The model is in a galactocentric frame G, in kiloparsecs:

- the origin is at the centre (Sgr A\*);
- +X lies along the Sun → centre line (galacticFrame.js's F, l = 0);
- +Y is the north galactic pole;
- +Z points toward l = 90°.

The Sun is at (−8.15, +0.0208, 0): R₀ = 8.15 kpc (Reid et al. 2019), 20.8 pc
over the mid-plane (Bennett & Bovy 2019).  The azimuth β is Reid et al.'s: 0
toward the Sun, growing with the Galaxy's rotation (clockwise from the north
pole).  The catalogue frame (metres from the Sun, the StellarFrame's
children) reaches G through galacticToSceneMatrix's transpose with Z
negated (`catalogToGalactic`).  galacticFrame.js's F has +Z = X × Y, the
centre × the pole, which is l = 270°.  The first cut took it for l = 90°
and drew the Galaxy's mirror image: arms leading the rotation, the bar's
near end at negative longitudes, the Aquila Rift at l = 332°.  A CPU render
of the inside view put the bulge's brightest side and the Ophiuchus cloud
on the wrong sides, and a test now holds l = 90° at +Z.  So the disc lies in the IAU galactic plane, with its
centre in Sagittarius, as the local catalogue's stars are placed.

## The model

A luminosity density, L☉ per kpc³, in V, normalised so the whole holds
**L = 2.5e10 L☉** (M_V ≈ −20.9).  Each component's constant is set by
integrating its profile over the volume the march covers (|x|, |z| ≤ 20 kpc,
|y| ≤ 5 kpc).  The discs' vertical profiles integrate to 1, so for them the
integral is over the map's texels, as the GPU samples them (`normalize`).  A
3D quadrature in the tests recovers every component within 0.3%.

| Component | Share of L | Profile | Parameters | Source |
|---|---|---|---|---|
| Thin disc | 0.48 | exp(−R/h_R)·exp(−\|z\|/h_z), a central deficit (×(1 − 0.9·e^(−(R/3)²))), the arms' modulation | h_R 2.6, h_z 0.30 kpc | Jurić et al. 2008 |
| Thick disc | 0.07 | the same, no deficit | h_R 3.6, h_z 0.9 kpc; about 6% of the thin disc's light at the Sun (12% of its density, older stars) | Jurić et al. 2008 |
| Boxy bulge | 0.20 | exp(−r_s), r_s⁴ = ((x/x₀)² + (y/y₀)²)² + (z/z₀)⁴ in the bar's frame | x₀ 1.25, y₀ 0.6, z₀ 0.45 kpc | Dwek et al. 1995's boxy form; Rattenbury et al. 2007's scales |
| Long bar | 0.05 | flat to its ends, exp(−\|across\|/0.4)·exp(−\|z\|/0.18) | half-length 5.0 kpc, at 27° to the Sun → centre line, the near end at l > 0 | Wegg, Gerhard & Portail 2015; Bland-Hawthorn & Gerhard 2016 |
| Young stars | 0.18 | the arms (below), exp(−R/3.5) | h_z 0.14 kpc | the gas disc's scale length; A dwarfs' scale height, Bovy 2017 |
| HII regions | 0.02 | 700 knots on the arms' outer edges, 30-90 pc (σ), and a faint glow along the arms | h_z 0.09 kpc | |

The bulge and bar are a quarter of the light: by mass they are about a third
(Bland-Hawthorn & Gerhard 2016), and old stars have more mass per light.

**Warp and flare.**  Past 9.5 kpc the mid-plane rises by
0.12·(R − 9.5)^1.33·sin(β − 17.5°): north toward l ≈ 90°, about a
kiloparsec by 15 kpc.  This is the classical Cepheids' warp (Chen et al.
2019).  Every scale height grows as exp((R − 9.5)/9), doubling by 15-16 kpc
(López-Corredoira et al. 2002; Momany et al. 2006).

**The arms** are logarithmic spirals, ln(R/r₀) = −β·tan ψ.  r₀ is where each
arm crosses the Sun → centre line: Reid et al. (2019)'s fit for that arm,
evaluated at β = 0.

| Arm | r₀, kpc | Pitch | Old stars | Note |
|---|---|---|---|---|
| Norma-Outer | 3.81 | 12° | no | between Reid's Norma (4.44) and Outer (12.44, one turn on) segments |
| Scutum-Centaurus | 5.43 | 12° | yes | starts at the bar's near end |
| Sagittarius-Carina | 6.87 | 12° | no | 1.3 kpc inside the Sun |
| Perseus | 10.07 | 12° | yes | starts at the bar's far end |
| Local (Orion spur) | 8.53 | 11.4° | no | a spur, β −35° to 60°, 0.45 strength |

The pitch is 12° for the four major arms: Reid et al.'s segments run 7-20°,
and Vallée 2017's mean is 13°.  Fitting all four with one pitch puts them
63°, 103°, 98° and 96° apart in azimuth, not 90°: the measured asymmetry.
Scutum-Centaurus and Perseus are the two arms the old stars show (Benjamin et
al. 2005; Churchwell et al. 2009).  They modulate the old disc by up to 1.6×
over a floor of 0.75; the others by 0.2.  Every arm carries the young stars.
An arm's young population is a Gaussian across it, σ = 0.15 + 0.03·R kpc
(0.39 at the Sun; maser arms are narrower, and the young stars' ages spread
them).  The arms fade in from just inside where each starts and fade out
from 13 to 19 kpc.

**Dust**, as an extinction coefficient in V:

- a disc of scale height 0.134 kpc (Drimmel & Spergel 2001) and scale
  length 3.5 kpc, with a central deficit inside 4 kpc;
- 1 mag/kpc in the mid-plane, averaged round the Sun's radius;
- lanes on each arm's inner (upstream) edge, 0.8σ in and 0.5σ wide, and
  along the bar's leading sides;
- clumped by fractal noise from 3 kpc down to 0.2 kpc;
- none inside the Local Bubble, 50-160 pc round the Sun (Lallement et al.
  2014);
- reddening by Cardelli et al. 1989's A_R : A_V : A_B ≈ 0.75 : 1 : 1.32.

Drimmel & Spergel's 2.3 kpc scale length gave A_V = 5.0 through Baade's
window, against a measured 1.5-2; 3.5 kpc, within the published range
(Misiriotis et al. 2006 fit 5 kpc), gives 2.0 from the disc, its lanes and
clumps.  With the named clouds below it is 2.07 ([calibrated](#the-inner-galaxy-calibrated)).

**The nearby dark clouds** make the Great Rift and the naked eye's dark
lanes: Aquila Rift, Serpens-Scutum, Cygnus Rift, Ophiuchus-Pipe, Coalsack,
Taurus and Orion, and the Vulpecula Rift between Aquila and Cygnus.  Their
positions and sizes are approximate, after Dame et al. 2001 and Lallement et
al. 2019.  Each is a Gaussian flattened to the plane (`CLOUDS`).  Along each
ray its column is spread as the cloud's own Gaussian along the ray, round
the ray's closest approach to it (`cloudOverStep`), so a camera inside a
cloud's reach sees its near half and not its far one.  It was a screen at
the closest approach, all or nothing: from 126 pc, 1.5σ from the Taurus
cloud, the rays whose closest approach fell just behind the camera lost
the cloud's whole column at once, a great circle with a hard edge across
the sky (#187's review; on `main` since #185, and shown by #186's
response).  They are
the local instances of the dust's clumps, so they fade out as the camera
goes 2-5 kpc from the Sun (`CLOUDS_NEAR_KPC`).  From outside they made the
Sun's neighbourhood the one spot of the disc with dark specks.

### The map

The in-plane structure is baked into a 1024² map over ±20 kpc (39 pc a
texel), four channels, square-root encoded in bytes (`bakeMap`):

- the old disc's arm modulation;
- the young population: arms, a faint interarm floor, and a blue cluster at
  each knot;
- the dust's modulation;
- the HII knots.

The radial and vertical profiles stay analytic in the shader.  The bake is
seeded, so the map is the same on every load.  It takes about 0.6 s in bun:
the arms' Gaussians, skipped where negligible.  `MilkyWay.js` bakes it in
16 ms slices between frames (a generator, `bakeMapSteps`), and the galaxy
appears when it's done.  On SwiftShader, whose frames are slow, that is
20-30 s; on a laptop, about a second.

## Its light, in exposure units

A column Σ of solar luminosities radiates Σ·L☉/4π per steradian, and the Sun
at 1 AU gives L☉/(4π AU²).  So in exposure units at Earth's keyed exposure
(HDR.md, "Physical stars"), a column of 1 L☉/kpc² is
**DISPLAY_GAIN·π·(AU/kpc)²** (`VALUE_PER_LSUN_KPC2`).  1 L☉/pc², 26.4
mag/arcsec² in V, is 1.1e-10.  The march integrates emission and extinction
along each ray in those units, and the pass multiplies by the frame's
exposure (`uExposureRelative`, pre-exposure), as the stars and the Sun do.

| Where | Model, all its light | Drawn, less the catalogue's share ([double counting](#double-counting)) | Measured |
|---|---|---|---|
| Luminosity density at the Sun | 0.048 L☉/pc³ | | about 0.05 (Flynn et al. 2006) |
| Column through the disc at the Sun | about 20 L☉/pc² | | 20-30 |
| Sky at the galactic poles, from the Sun | 23.6-23.8 mag/arcsec² | 24.6-24.7; with the catalogue's points, 23.6 | 23.5-24 (integrated starlight, Leinert et al. 1998) |
| The band, l = 330°, b = −5° | 20.9 | 21.0 | |
| Carina, l = 287°, b = −1° | 21.2 | 21.4 | |
| Baade's window, l = 1°, b = −4° | 20.4, A_V 2.1 | 20.4 | A_V 1.5-2 |
| The Sagittarius star cloud, l = 2°, b = −6° | 20.3, A_V 1.3 | 20.4 | about 20-20.5 |
| The Scutum cloud, l = 27°, b = −3° | 21.4, A_V 4.0 | 21.5 | about 20.5 |
| Cygnus in the plane, l = 78° | 22.6, A_V 9.8 | 23.2 | about 21 |
| Anticentre in the plane | 22.3 | 22.6 | about 22 |
| Face-on: centre / 4 kpc / the Sun's radius / 15 kpc | 19.5 / 21.2 / 23.0 / 25.3 | | |

At the dark-adapted gain (4e6) the band is 0.01-0.07 in exposure units and
the poles 0.002.  From 40 kpc face-on the bulge's column is 6e-8 at Earth's
keyed exposure: 6 in the march's target (`STORE_SCALE` 1e8), well inside
half-float's range.

## The pass

`MilkyWay.js` draws one full-screen triangle in the scene pass.  Its depth is
pinned to the far plane, as the point cloud's was, behind every
depth-writing object, with additive blending and renderOrder −2 (under the
stars).  Where the buffer is float that draw only runs the march (its
colour writes are off): the atmosphere pass draws the light, as the night
sky's, where the scene's depth is at or behind that far-plane depth, so
the eye's response to extended light can tone-map it apart from the stars
(HDR.md, [the eye and extended light](HDR.md#the-eye-and-extended-light)).
The LDR fallback composites it here, as before.

For each pixel the view ray comes from the projection matrix (its offsets
included) and is turned into G by the camera's rotation, the StellarFrame's
inverse and the catalogue → G turn.  The camera's position in G is taken in
float64 on the CPU, as `rte.js` does.  So the rebase and the precession
reach it, and the shader works in kiloparsecs.

**The march** (`galaxyMarch`, and `integrateRay` in JS, the same
arithmetic):

1. Clip the ray to the box.
2. Step along it: across the plane, at most 0.3 × the height over the warped
   mid-plane, never under 0.02 kpc of height; along it, at most the
   segment / 96, never under 0.25 kpc.  At most 192 steps.
3. Integrate emission × (1 − e^(−κΔs))/κ per channel through the dust,
   exactly for a step of constant density.
4. Pass the clouds as screens at their closest approach.
5. Stop when the transmittance is under 1e-3.

Face-on from outside that is about 60 steps; from the Sun, 30 toward the
poles and up to 100 along the plane.  Interleaved gradient noise offsets the
first step, fixed per pixel, so the steps don't band.

**Cached, at reduced resolution.**  Where the buffer is float (HDR.md), the
march renders into a half-float target at most 540 rows tall (and at most
half the frame), holding the light unexposed × 1e8.  It runs only when the
camera's position, rotation, projection or the target's size changes.  Each
frame the atmosphere pass then samples the target and applies the
exposure, so a still view costs one texture read a pixel.  The galaxy is smooth at that resolution;
the HII knots, 1-2 px at 40 kpc, are the finest thing in it.  In the LDR
fallback the composite marches itself, at full resolution, every frame.

## Exposure: framed as a photograph from outside

The meter (HDR.md, "Metered exposure") keys the frame's mean, which the black
round a galaxy floors.  It stops at the dark-adapted eye's gain, 4e6, where a
disc of 21-24 mag/arcsec² is 0.01-0.1, in the tone map's toe: faint arms
round a small bar, the user's view.  A camera framing a galaxy exposes for
the galaxy, so **from outside it anchors the gain** (`exposure.js`
`galaxyGain`, rule 10):

- The meter's readback gives the frame's lit part: the pixels within 1e-3 of
  its 2% highlight.  The anchor brings the brightest 2% of those (the bulge
  and the bar) to 1.5 in exposure units, a white surface's, at the tone map's
  shoulder.
- It is blended in log gain by how far outside the galaxy the camera is
  (`outsideWeight`: an ellipsoidal radius over 18 kpc in the plane and 4 kpc
  across it, from 1 to 1.6), and by the lit part's share of the frame (0.5%
  to 5%, so a smudge in the field leaves the gain to the frame).
- It may pass 4e6, as a long exposure does, up to 1e10 over Earth's keyed
  exposure.

The stars' limit deepens with the gain (a magnitude for 2.5×).  From outside,
the catalogue's stars are fainter than magnitude 11, so at 1e8 (limit 10)
almost none show.

Keying the mean of the whole lit part was the first cut.  The faint outskirts
are most of the lit pixels, so it ran the gain to 5e8 and blew the whole
inner disc to a cream white.  Keying the brightest tenth to 1.0 still blew
the bar.

Settled gains in the evidence: face-on from 45 or 100 kpc 1.2e8, oblique
from 50 kpc 8.3e7, edge-on from 80 kpc 5.2e7.

**Inside the galaxy the eye's gain stays.**  `outsideWeight` is 0 anywhere
in the disc, so the night sky, the star field and its limit are untouched.
From 3 kpc over the Sun the disc below shows at the dark gain.

## From inside: the band

The band's radiance is physical (the table above).  At the dark-adapted gain
it is 0.01-0.07 in exposure units, in Neutral's toe (quadratic under 0.08):
it showed 2-5 of 255 toward the centre, about 2 elsewhere, 1 at the poles.
That was the eye's calibration, not the galaxy: the gain is set so a
magnitude 6.5 star just shows over the eye's 10′ patch, a surface brightness
of 20.3 mag/arcsec², and the eye sees extended light far fainter than that,
against a night sky whose own light wasn't drawn.

[#186](https://github.com/celestiary/web/issues/186) draws both halves of
the answer (HDR.md, [the eye and extended light](HDR.md#the-eye-and-extended-light)):

- **The night sky's own light**: airglow, from Earth's surface, and the
  zodiacal light and gegenschein from anywhere in the inner solar system,
  with the galaxy's light, all in exposure units, so the meter adapts to
  them (the dark-adapted gain stays 4e6: they are under its floor, but
  for the zodiacal light within about 25° of the Sun).
- **The eye's response to extended light**: the rods pool light over
  degrees, so their threshold for a large field is a tenth over the sky,
  where a point needs 4.7 times it.  The night sky's light is tone-mapped by
  a response of its own, 2.2 times the stars' gain at full dark
  adaptation (threshold mapping: the eye's just-visible difference on the
  sky is the display's), greyed as rods see it, and added over the stars'
  image in display values, so the stars' calibration is untouched.

From a dark site at −30° on a July night, local midnight, the sky shows
12-15 of 255 and the band up to 33-42, grey, its bright side south of the
plane toward the centre, with the dust lane along it; from space at 1 AU
the sky is black between the band's 30-40 and the zodiacal light.  The
numbers are in HDR.md ([measured](HDR.md#measured)), the evidence in
[#187](https://github.com/celestiary/web/pull/187).

### The inner Galaxy, calibrated

#186's first cut showed the band, but its brightest parts were where the
model put them, not where the sky does: Sagittarius, Scutum and Cygnus at
22-23.5 mag/arcsec², against about 20-20.5 measured (#187's review).  The
dust was too thick toward the inner Galaxy: A_V 3.8 through Baade's window
where 1.5-2 is measured, of which 1.9 was the named clouds' tails (the
Ophiuchus-Pipe cloud's, 10° away, and the Aquila Rift's and
Serpens-Scutum's, whose Gaussians, 8-15° across, reached over the Scutum
and Sagittarius clouds).  The disc, its lanes and clumps alone give 2.0.
So the clouds were tightened to their measured extents (Dame et al. 2001's
CO, Lallement et al. 2019's 3D dust), as Gaussians' σ: the Aquila Rift
from 60 by 30 pc to 45 by 15 pc at 220 pc (15° by 8° to 12° by 4°), its
centre to (30°, +5°), north of the plane, where the rift is; Serpens-Scutum
from 100 by 40 pc to 60 by 25 at 450 pc, at b = 3°; the Pipe from 20 to 12
pc at 135 pc (5°); the Cygnus Rift from 200 to 80 pc along the plane at 800
pc; and the Vulpecula Rift added (A_V 2 at 400 pc, l = 55°), so the Great
Rift runs on from Aquila to Cygnus.  Peak A_V are unchanged.  The band from the Sun, the
brightest within 10° of the plane and in it, in mag/arcsec² (V), all the
model's light, `main` against this change:

| l | Brightest, `main` → now (at b) | b = 0°, `main` → now | Measured, about |
|---|---|---|---|
| 0° | 21.2 → 20.3 (−5°) | 23.1 → 21.4 | 20-20.5 (Sagittarius) |
| 7° | 21.3 → 20.4 (−6°) | 23.2 → 21.7 | 20-20.5 |
| 17° | 21.6 → 20.7 (−6.5°) | 23.1 → 22.4 | 20.5 |
| 27° | 21.9 → 21.0 (−6°) | 23.0 → 22.4 | 20.5 (Scutum) |
| 45° | 22.0 → 21.4 (−5.5°) | 22.5 → 22.3 | 21 |
| 60° | 22.2 → 21.8 (−5.5°) | 22.6 → 22.6 | 21 |
| 78° | 22.3 → 22.1 (−6°) | 22.6 → 22.6 | 21 (Cygnus) |
| 100° | 22.0 → 21.7 (1.5°) | 22.1 → 21.7 | |
| 180° | 22.2 → 22.2 (3°) | 22.2 → 22.3 | 22 (anticentre) |
| 240° | 22.0 → 22.0 | 22.0 → 22.0 | |
| 287° | 21.2 → 21.2 | 21.2 → 21.2 | 21 (Carina) |
| 330° | 20.8 → 20.7 (4°) | 21.0 → 21.0 | 20.5-21 |
| The poles | 23.8 / 23.6, unchanged | | 23.5-24 |

A_V through Baade's window is 2.07 (3.84), through the Sagittarius star
cloud at (2°, −6°) 1.3 (2.6), and over the Scutum cloud at (27°, −3°) 4.0
(6.6).  The Great Rift still reads as a rift: at l = 30° the band 3° north
of the plane is 0.26 of the band 3° south (0.72 before: the old screen
darkened both sides), and at l = 45° the plane is 0.44 of b = −5° (0.66).
`galaxyModel.test.js` holds Baade's A_V at 1.5-2.25, the brightest of the
band toward the centre under 20.8, and the rift's contrast.

The measured column is Pioneer 10's integrated starlight, mapped from
beyond the zodiacal cloud (Toller 1981; as tabulated by Leinert et al.
1998), as recalled, to perhaps 0.3 mag.  Toward the centre the band now
agrees.  Scutum is 0.5 mag faint, and Cygnus about 1 mag: looking down the
Local Arm, the model's A_V is 7-10 in the plane and its band's brightest is
6° south of it, where the sky's Cygnus star cloud is north of the rift at b
≈ +2°.  That is the Local Arm's dust and light, the in-plane map's, a
follow-up (below).

## Double counting

The catalogue's stars (stars.dat, Hipparcos-based) are drawn as points over
this light, and near the Sun they are part of it: the same light was
counted twice.  Measured from the Sun, the catalogue's light by distance
against the model's emission there (its luminosity density times its own
dust, per steradian), over the sky:

| Distance from the Sun | 25-50 pc | 50-100 | 100-200 | 200-300 | 300-400 | 400-600 | 600-800 | 800-1,200 | 1.2-2 kpc |
|---|---|---|---|---|---|---|---|---|---|
| Resolved, \|b\| < 10° | 1.01 | 0.92 | 0.97 | 0.48 | 0.37 | 0.26 | 0.11 | 0.04 | 0.01 |
| Resolved, 10-30° | 0.94 | 0.98 | 0.89 | 0.58 | 0.31 | 0.15 | 0.09 | 0.02 | 0.00 |
| Resolved, 30-90° | 1.01 | 0.88 | 0.68 | 0.44 | 0.26 | 0.14 | 0.08 | 0.04 | 0.01 |

The catalogue resolves nearly all of the model's light within 200 pc (its
luminosity density matches the model's 0.048 L☉/pc³ there, a check on #99's
normalisation), half at 250 pc, a tenth at 700 pc (its giants reach
farther than its dwarfs), none past 1.5 kpc.  Over the whole sky its stars
hold 35% as much light as the model: 26% of the model's in the plane (|b| <
5°), 56% toward the poles (|b| > 60°).  So it matters: the model was
normalised to the measured integrated starlight, all the stars' light, and
with the points over it the sky toward the poles was 23.1 mag/arcsec²,
40-60% over the measured 23.5-24.

**The fix.**  The march leaves out the catalogue's share, `RESOLVED`: h(s)
= 1 / (1 + (s / 0.234 kpc)²) of the emission at a distance s from the Sun,
a fit to the table above (0.91 at 75 pc, 0.47 at 250, 0.31 at 350, 0.18 at
500, 0.10 at 700).  That form integrates in closed form along a ray
(`resolvedOverStep`: with the ray's closest approach b to the Sun, the
integral of 1/(1 + s²/a²) is a²/c·atan((t − t_c)/c), c² = a² + b²), so the
march's quarter-kiloparsec steps in the plane take it exactly, with no new
steps.  What it leaves out is 93% of the catalogue's light over the sky
(`galaxyModel.test.js` holds 85-115%): 20% of the model's in the plane, 57%
toward the poles, where the points and the diffuse light now make 23.6
mag/arcsec², inside the measured range.

It applies while the catalogue's light near the Sun shows as points: from
farther away its stars fall under the eye's limit (a giant at the Sun is
fainter than 6.5 from 0.2-0.3 kpc), their light is lost in the tone map's
toe, and the hole would read as a dark dimple round the Sun.  So it fades
out as the camera goes from 0.1 to 0.4 kpc from the Sun (`RESOLVED.near`),
and from outside the galaxy the disc is whole.  Gaia's stars (#98) resolve
more, farther: the fit's scale grows with them.

## Performance

Measured on SwiftShader at 480×360, a frame timed to `gl.finish`, the
median of seven:

| View | Point cloud, camera moving | Integrated light, camera moving (re-marched each frame) | Integrated light, camera still (cached) |
|---|---|---|---|
| Face-on from 45 kpc | 244 ms | 197 ms | 103 ms |
| From the Sun toward the centre | 197 ms | 204 ms | 83 ms |

The galaxy is two draw calls: the march into its target when the view has
changed, and the composite.  "Changed" is by more than the target can
show (`viewCache.js`): the view turned half a texel, the camera moved a
micro-kiloparsec, or the projection changed.  It was any change at all, so
with time running the sky's turning re-marched it every frame; now from the
ground at 2 minutes a second it is re-marched every few frames.  And where
the night sky can't show, by day and in most of twilight, it isn't marched
(HDR.md, [cost](HDR.md#cost-by-day-and-with-time-running)).  The scene drops the cloud's 60,000 points
(106,753 points drawn, the stars, against 166,753).  The march costs
(the frame's pixels / 4, at most 540 rows) × 30-100 steps × a map read
and the density's arithmetic.  At 1080p it is 518k march pixels, at most
about 50M steps while the camera moves, none while it's still.  Not
measured on a real GPU here: the user's preview is the check.

The bake is about 0.6 s of arithmetic, done in slices between frames.

## Sources

- Bennett, M. & Bovy, J. 2019, MNRAS 482, 1417: the Sun's height.
- Benjamin, R. A. et al. 2005, ApJ 630, L149; Churchwell, E. et al. 2009,
  PASP 121, 213: the two stellar arms.
- Bland-Hawthorn, J. & Gerhard, O. 2016, ARA&A 54, 529: the review (bar,
  bulge, masses, luminosity).
- Bovy, J. 2017, MNRAS 470, 1360: A-dwarf scale heights.
- Cardelli, J. A., Clayton, G. C. & Mathis, J. S. 1989, ApJ 345, 245:
  reddening.
- Chen, X. et al. 2019, Nature Astronomy 3, 320: the warp (Cepheids).
- Dame, T. M., Hartmann, D. & Thaddeus, P. 2001, ApJ 547, 792: CO, the
  clouds.
- Drimmel, R. & Spergel, D. N. 2001, ApJ 556, 181: the dust disc.
- Dwek, E. et al. 1995, ApJ 445, 716: the bulge's boxy forms.
- Flynn, C. et al. 2006, MNRAS 372, 1149: the local luminosity density.
- Jurić, M. et al. 2008, ApJ 673, 864: the thin and thick discs.
- Lallement, R. et al. 2014, A&A 561, A91; 2019, A&A 625, A135: the Local
  Bubble, 3D dust.
- Leinert, Ch. et al. 1998, A&AS 127, 1: the night sky's brightness.
- Licquia, T. C., Newman, J. A. & Bershady, M. A. 2016, ApJ 833, 220: the
  luminosity.
- López-Corredoira, M. et al. 2002, A&A 394, 883; Momany, Y. et al. 2006,
  A&A 451, 515: the flare.
- Misiriotis, A. et al. 2006, A&A 459, 113: the dust's scale length.
- Rattenbury, N. J. et al. 2007, MNRAS 378, 1064: the bulge's scales.
- Reid, M. J. et al. 2019, ApJ 885, 131: R₀ and the arms; Reid et al. 2014,
  ApJ 783, 130: arm widths.
- Toller, G. N. 1981, PhD thesis, SUNY Stony Brook; Toller, G. N. et al.
  1987, A&A 188, 24: the integrated starlight from Pioneer 10, beyond the
  zodiacal cloud.
- Vallée, J. P. 2017, Astronomical Review 13, 113: the mean pitch.
- Wegg, C., Gerhard, O. & Portail, M. 2015, MNRAS 450, 4050: the long bar.

These were cited from the literature as recalled; the sandbox reaches
neither arXiv nor ADS.  Reid et al.'s Perseus fit (R_kink 8.87 kpc) was
confirmed through a search; the other arm parameters and the values above
should be checked against the papers before anything leans on them to
better than 10-20%.

## Follow-ups

- Done: the night sky's own light and the eye's sensitivity to extended
  light, so the band shows from inside at the dark-adapted gain (#186;
  above), and the hole round the Sun for what the catalogue resolves
  ([double counting](#double-counting)).
- Done: the inner Galaxy's dust, calibrated to Baade's window and the
  Sagittarius clouds ([above](#the-inner-galaxy-calibrated)), and the
  clouds' columns spread along the ray, so no cloud has an edge from
  inside its reach.
- The inner zodiacal cloud is too flat near the Sun (HDR.md, [round the
  Sun](HDR.md#round-the-sun-the-rim-and-the-jump)): Kelsall's fan, fitted
  from 1 AU, makes the lens 5 times fainter across the ecliptic than along
  it at 2-5° from the Sun, where the F-corona is nearly round.
- Cygnus and the Local Arm: the band there is about 1 mag faint, its
  brightest 6° south of the plane where the sky's is 2° north; the Local
  Arm's dust lane and young stars, as the in-plane map has them, need
  checking against Lallement et al.'s 3D dust.
- Gaia's stars over this light (#98): `RESOLVED` refitted to what they
  resolve, by the same measurement.
- The far side's arms are extrapolations of the near side's fits.
- Done: other galaxies from the same model with their own parameters,
  SPARC's 175 ([Galaxies.md](Galaxies.md), #221).  The dynamics (#106)
  move the arms as density waves, on SPARC's rotation curves too.
