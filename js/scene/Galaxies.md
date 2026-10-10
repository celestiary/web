# SPARC's galaxies: 175 discs from their published parameters

[#221](https://github.com/celestiary/web/issues/221), item 5.1 of the
[roadmap](../../ROADMAP.md#now--next--later), in [#117](https://github.com/celestiary/web/issues/117).
The 175 disc galaxies of SPARC (Spitzer Photometry and Accurate Rotation
Curves; Lelli, McGaugh & Schombert 2016) are drawn as the Milky Way is
([MilkyWay.md](MilkyWay.md)): a luminosity density from structural
components, normalised to the galaxy's luminosity in exposure units,
through its own dust, ray-marched.  Each is primed from what was measured
of it, and the Hubble type fills in what wasn't, from published trends,
the way the planets' parameters prime their procedural surfaces.  They are
placed at their distances and positions on the sky, turned by their
inclinations and position angles, searchable (`NGC 2403`, `M 63`, `WLM`)
and flyable (`#galaxy:ngc2403`), named on the sky (`e`, by magnitude;
[labels](#labels)), and a targeted galaxy's info panel plots its rotation
curve against the one its stars and gas alone would give.

Code:

- `galaxyModel.js`: the model, now for any galaxy (a *spec*); the Milky
  Way is the spec `MILKY_WAY`.
- `sparcGalaxy.js`: a SPARC galaxy's spec from its row, and its far point's
  dust (`attenuationTable`).
- `Galaxies.js`: the three levels of detail, the bakes, the records the
  search and the scene use.
- `rotationCurve.js`: the curve and the baryons' velocity, the panel's plot.
- `tools/sparc/buildSparc.mjs`: the data, and `public/data/sparc/`.

## The data

`public/data/sparc/galaxies.json` (208 KB) and `curves.json` (106 KB),
built by `tools/sparc/buildSparc.mjs` (below), plain JSON under
`public/data/`: well under the data policy's 1 MB, so not LFS.

| What | Where from | Per galaxy |
|---|---|---|
| Type T (0 S0 to 11 BCD), distance and its method and error, inclination, L[3.6], R_eff, the disc's scale length and central surface brightness, M_HI, R_HI, V_flat, quality | SPARC Table 1 (`SPARC_Lelli2016c.mrt`) | all 175 |
| The bulge's [3.6] luminosity | SPARC `Bulges.mrt` | 32 with a bulge |
| The disc's and the bulge's 3.6 µm surface brightness profiles (the bulge-disc decomposition): the disc's shape, the bulge's half-light radius | SPARC `BulgeDiskDec_LTG.zip` (`.dens`) | all 175 |
| The rotation curve, V_gas, V_disk, V_bul | SPARC Table 2 (`MassModels_Lelli2016c.mrt`) | all 175 (`curves.json`) |
| Position (J2000, ICRS) and preferred name | NED's name resolver | 175 |
| Main identifier, position angle with its bibcode, morphological type | SIMBAD TAP, a cone of 30″ round NED's position | 174 |
| B_T, (B-V)_T, B_T^0, (B-V)_T^0, A_g, the de Vaucouleurs type (bar family), D25, R25, position angle | RC3 (de Vaucouleurs et al. 1991, VizieR VII/155), the nearest within 60″ | 149; photometry for 97 |
| Position angle, D25 | HyperLEDA's PGC 2003 (Paturel et al. 2003, VizieR VII/237), within 30″ | 173 |

**Licence and citation.**  SPARC's page (astroweb.case.edu/SPARC) asks
users to cite the SPARC master paper, Lelli, McGaugh & Schombert 2016, AJ
152, 157 (and the original rotation-curve sources, listed in Table 1), and
states no other terms.  The same tables are VizieR's J/AJ/152/157
(doi:10.26093/cds/vizier.51520157), whose records name CDS's licence page
as their rights (`cds.unistra.fr/vizier-org/licences_vizier.html`, which
the sandbox can't reach): CDS distributes VizieR catalogues under CC BY
4.0 as far as recalled, to be confirmed on that page.  SIMBAD and VizieR
ask for an acknowledgement ("This research has made use of the SIMBAD
database / the VizieR catalogue access tool, CDS, Strasbourg"), and NED
for one to NASA/IPAC.  The about box should carry those lines when there
is one.

### The cross-match

SPARC has names, not coordinates.  Every name resolves in NED (175 of
175; `meta.failed` is empty), and NED's position is the galaxy's.  SIMBAD
is then asked for the galaxies within 30″ of it, and the one with SPARC's
or NED's name among its identifiers taken (154), else the largest there
(20, the LSB galaxies' `F5xx-x` and `D5xx-x` names SIMBAD doesn't know,
KK98-251 and PGC 51017, all within 10″ and most within 2″; median
separation 0.5″); UGC 2455 (NGC 1156) has none.  NED's name differs from
SPARC's for 61, all the same galaxy under another designation (NGC 4789A
for DDO 154, UGC 4115 for D631-7, WLM for UGCA 444, M 63 for NGC 5055) or
the LSB catalogue's zero-padded form (LSBC F568-01), checked against SPARC's
distances (Hubble-flow distances within 50% of NED's redshift over 73
km/s/Mpc but for two nearby TRGB distances, KK98-251 and UGC 7603, where
peculiar velocities dominate) and the optical sizes (R25 against R_disk).

**Position angles** come from three sources that disagree by 40-100° for
about a dozen galaxies (UGC 2885: SIMBAD 90°, RC3 40°, HyperLEDA 41°), so
where two agree within 15° their mean is taken (129: HyperLEDA and RC3 113,
HyperLEDA and SIMBAD 12, RC3 and SIMBAD 4), else HyperLEDA's (an average
over the literature), RC3's or SIMBAD's (38).  Eight have none (Cam B,
F565-V2, F567-2, F574-2, KK98-251, NGC 6946, UGC 731, UGC 12632; NGC 6946 is
nearly face on): the seed draws one, and the info panel says "not
measured".  These are photometric angles; SPARC's own kinematic ones aren't
published in its tables.

## The model, for any galaxy

`galaxyModel.js` was the Milky Way's.  Every constant it had is now a field
of a spec (`MILKY_WAY` gathers them, and the old exports stay): the
luminosity and its split, each disc's scales, the bulge and bar, the arms,
the dust and its normalisation, the map's extent, the march's bounds and
steps, the colours.  What only the Milky Way has (its warp and flare, the
Great Rift's clouds, the Local Bubble, the share the star catalogue
resolves round the Sun) is the spec's or `milkyWay`'s, and off for every
other galaxy.  Additions, each off in `MILKY_WAY`:

- **A bulge's profile index** `n` (exp(−r^(1/n)), 1 the Milky Way's) and
  an **ellipsoidal bulge** (`bar.boxy: false`), normalised by
  4π·n·Γ(3n); the boxy one by its quadrature as before, or for n ≠ 1 by
  the same shape constant times n·Γ(3n).
- **A measured radial profile** (`profileRatio`): the old disc's map
  channel carries the 3.6 µm disc profile's departure from the exponential
  the shader draws, so truncations, rings and inner excesses are the
  measured ones.
- **A lopsided old disc** (an m = 1 mode), **flocculent arms** (noise
  along each arm cuts it into segments), and **star formation in clumps**
  for galaxies without arms (groups of knots round off-centre complexes,
  with their diffuse young light and dust).

**The Milky Way is unchanged.**  Its generated GLSL, its baked map's bytes,
its normalisation, its density at sample points and the light along sample
rays are byte for byte what they were (compared before and after the
refactor), and its 94 tests pass as they were.  Rendered, the band from
the Sun is identical to `main`'s, pixel for pixel, and the face-on view
from 45 kpc differs by at most 1 of 255 (the meter settling a hair
differently) but for six SPARC galaxies' points behind the disc
(evidence in the PR).

**One program for every other galaxy.**  The Milky Way's march is its own
program, its values written in as constants.  SPARC's 175 can't each
compile one, so `galaxyGlsl(null, {uniforms: true})` is the same march with
the structure in uniforms (`uGalP[8]`, `uGalC[4]`, `galaxySpecUniforms`)
and without what only the Milky Way has; each galaxy's map is a texture.

## A galaxy's parameters

`sparcSpec(row, defaults)`: measured where SPARC, RC3 or the cross-match
measured it; the type's default where not, each from a cited trend; and
the seed (FNV-1a of the name) where neither says (the arms' phase, a
missing position angle, which side of the disc is nearer).  The info panel
says which (`meta`: the luminosity's source, the colour and bar family
measured or not).

| Parameter | Measured (source) | Else (default, source) |
|---|---|---|
| Position, distance | NED's RA, Dec (all); SPARC's D (all) | |
| Disc orientation | SPARC's inclination (all); PA, consensus of HyperLEDA, RC3, SIMBAD (167) | PA drawn (8) |
| Near side, sense of rotation | no catalogue has them | drawn |
| Thin disc's scale length h_R | SPARC R_disk at 3.6 µm (all) | |
| Disc's radial profile | the 3.6 µm decomposition's disc, face on (all) | |
| V luminosity, face on | RC3's B_T^0 − (B−V)_T^0 at SPARC's distance (97) | L[3.6] × 10^(0.349 − 1.308 (B−V)^0) (78; the fit below) |
| Colour (B−V)^0 | RC3's (B−V)_T^0 (97) | the type's median among those 97 (pooled bins: S0-Sa 0.82, Sab 0.79, Sb-Sbc 0.64, Sc 0.46, Scd-Sd 0.42, Sdm-Sm 0.43, Im-BCD 0.41) |
| Bulge's share of V | SPARC's L_bul / L[3.6], reddened by its colour (32) | none |
| Bulge's size | the decomposition's half-light radius (32) | |
| Bulge's profile and flattening | | n 3 (S0-Sa) to 1 (Sc on), c/a 0.7 to 0.5: classical against pseudobulges (Fisher & Drory 2008; Kormendy & Kennicutt 2004) |
| Bar | RC3's family, else SIMBAD's (115: 37 SB, 32 SAB, 46 SA) | drawn at the sample's barred and weakly barred shares for the type (60) |
| Bar's length, width, share | | half-length 1.3 / 1.0 / 0.7 h_R early to late (Erwin 2005), 1.0 for Magellanic irregulars (de Vaucouleurs & Freeman 1972); width 0.25 of it (0.35 irregulars; Gadotti 2011's ellipticities); Bar/T 0.10 strong, 0.05 weak (Gadotti 2011) |
| Young population's share | from the colour (97 measured, 78 the type's) | |
| HII regions' share | | 0.11 of the young's (the Milky Way's 0.02 / 0.18) |
| Thick disc | V_flat (135), else the curve's highest | thick:thin light 0.25 at V ≥ 150 to 1 at ≤ 70 km/s (Yoachim & Dalcanton 2006; Comerón et al. 2011); h_R ×1.25, h_z ×2.5 (Yoachim & Dalcanton 2006) |
| Thin disc's scale height | | h_R/h_z 6 (S0) to 10 (Sc-Sd), 3-4 for Sm-BCD (de Grijs 1998; Kregel, van der Kruit & de Grijs 2002; Sánchez-Janssen et al. 2010) |
| Young disc, HII layer | | the Milky Way's proportions: h_R ×1.35, h_z ×0.47, HII h_z ×0.3 |
| Dust | | τ_V face on through the centre 0.1 (S0), 0.6-0.8 (Sa-Scd), 0.5-0.4 (Sd-Sdm), 0.25-0.15 (Sm-BCD) (Xilouris et al. 1999; dwarfs' low dust-to-gas, Rémy-Ruyer et al. 2014); its scale length 1.4 h_R, height half the thin disc's (Xilouris et al. 1999); Cardelli's reddening |
| Arms: number | | m = 2 (Sa-Sbc); 2 or 3 (Sc); 3 or 4 (Scd-Sdm); 1 (Sm) |
| Arms: pitch | | 8° (Sa) to 23° (Sdm), ±5° at a type (Kennicutt 1981; Ma 2002); 25° for Sm |
| Arms: in the old stars; flocculence | | old-star arms to Sc (3.6 µm arm contrast 1.3-2, Elmegreen et al. 2011, as the Milky Way's 0.75 + 0.6); segmented from Sc, most in Scd-Sd (Elmegreen & Elmegreen 1987) |
| Young stars between the arms | | a third of an arm's (arm/interarm star formation 1.5-3, Foyle et al. 2010) |
| Lopsidedness A1 | | 0.03 (S0) to 0.2 (Im) (Zaritsky et al. 2013; Swaters et al. 1999) |
| Irregulars' star-forming complexes | | 6-30 by the young light, 0.12 h_R across, off centre by up to 0.3 h_R (0.1 for BCDs, concentrated within 0.4 h_R), a third of the young light diffuse (Hunter & Elmegreen 2004) |
| Component colours | | B−V 0.96 for bulge, bar and thick disc (Fukugita, Shimasaku & Ichikawa 1995's E), 0.78 the old thin disc (their Sab), −0.05 the young (a 10^8 yr population); HII the Milky Way's pink.  Each B−V's colour temperature (Ballesteros 2012) and its blackbody's colour, as the stars' (stellar.js) |

Recalled values: the trends by type above are from the literature as
recalled; the sandbox reaches neither ADS nor arXiv.  None of them is
fitted to look a particular way; each should be checked against its paper
before anything leans on it to better than 20-30%.

### The light

A galaxy's luminosity is its face-on V luminosity, before its own dust,
which the march then applies at whatever angle it is seen.  RC3's B_T^0 and
(B−V)_T^0 are corrected for the Milky Way's extinction and the galaxy's
own (de Vaucouleurs' inclination correction).  For the 78 without them,
the V light comes from L[3.6] by a fit to the 97 that have both:

    log10(L_V^0 / L[3.6]) = 0.349 − 1.308·(B−V)^0      (rms 0.22 dex)

which is physics, not just a fit: [3.6] traces stellar mass at a nearly
constant mass-to-light ratio, and V is that mass over V's ratio.  The slope
is Bell et al. (2003)'s 1.305 for log Υ_V against B−V, and with their zero
point the intercept puts Υ[3.6] at 0.53, SPARC's adopted 0.5 (McGaugh &
Schombert 2014).  `sparcGalaxy.test.js` recomputes it.

The young population's share is what makes the galaxy's B−V from its
components' (`youngShare`: B/V adds by light), held to 0-0.5; the bulge's
V share is its [3.6] share reddened by its colour against the whole's.
The thin disc takes the rest.

Seen from far away the model's own dust takes 10-15% face on, a third at
75° (NGC 3198) and up to 60-70% edge on.

## Families: how far one glow model goes

All 175 are one model and one shader.  What differs by type is only how
the in-plane map is baked:

| Family | Types | In SPARC | Map |
|---|---|---|---|
| lenticular | S0 (T 0) | 3 | no arms, no young population, a nearly smooth old disc, little dust |
| spiral | Sa-Sdm (1-8) | 101 | log-spiral arms: grand design to Sbc, segmented (flocculent) from Sc |
| magellanic | Sm (9) | 27 | one weak arm, and star formation in clumps, off centre |
| irregular | Im (10) | 39 | clumps, off centre, a lopsided old disc |
| bcd | BCD (11) | 5 | clumps concentrated in the middle |

So no family needed a shape of its own: S0s are the model without its
arms and young stars (and so look like a lens with a bulge), and
irregulars and BCDs the model with star formation in complexes in place of
arms.  Ellipticals are out of scope (SPARC has none); a Sérsic family for
them is the bulge with no disc, from another catalogue (#40).

What the one model can't do yet, from the renders: M 63 (NGC 5055) and
other flocculent Sbc galaxies draw with two smooth arms, since the type
says grand design; the edge-on S0-Sb discs (NGC 4013) look a little fat at
the exposure that keys their bulge, without a boxy/peanut bulge; and the
Magellanic irregulars' bars are centred, where the LMC's is off centre.

## Levels of detail

175 galaxies can't each be marched every frame.  `Galaxies.js` draws them
in three ways, all in exposure units (HDR.md), pre-exposed, additive, in
the scene pass (so the meter reads them, and from outside the Milky Way the
photograph rule, `exposure.js` `galaxyGain`, keys the frame to whichever
galaxy fills it):

1. **Far: a point.**  One `Points` draw for all 175 and the Milky Way (its
   own point, for views from beyond it).  A point carries the galaxy's
   light as a star's point does (HDR.md, "Physical stars"): its illuminance
   over the Sun's at 1 AU, L/L☉·(AU/d)², times DISPLAY_GAIN·π, over the
   eye's 10′ patch (or a pixel where coarser), as a Gaussian a quarter of
   the patch wide.  Its dust is what `attenuationTable` gives at the cosine
   of the angle between its pole and the line of sight: plane-parallel
   slabs of its discs under its dust, tabulated at five angles and
   interpolated in the shader (`sparcGalaxy.test.js` holds it within 20% of
   the march's at 0°, 60° and 75°).  In logs, as the stars' inverse square
   is, with no square of a distance in metres.  The user's star gain (`[`,
   `]`) is the stars'; the galaxies take the exposure compensation (`ev=`)
   only, as all extended light does.
2. **Resolved: an impostor.**  Once a galaxy (4 h_R, about its R25) is
   larger than the patch, its light goes over to its image as it grows from
   one patch to two: the same light, since a column of L☉/kpc² over its solid
   angle is the point's DISPLAY_GAIN·π·(AU/d)² per L☉ (a test holds them
   equal).  The image is an orthographic march of the model along the line
   of sight into a half-float texture of 32-256 texels a side, on a quad at
   the galaxy facing the camera, its frame fixed by the galaxy's pole so
   that rolling the camera doesn't re-march it.  It is marched again when
   the view of it turns 0.5° or it needs more texels; at most two a frame,
   at most eight impostors, the largest on screen.
3. **Near: the full march.**  Within 6 bounding radii (6 h_R) of the
   nearest galaxy its perspective march takes over from its impostor, fully
   by 4: Milky Way's arithmetic and cache (`viewCache.js`), into a target of
   at most 540 rows and half the frame, marched again only when the view
   changes by more than it shows.

**Maps** are baked when a galaxy is first resolved: 256² for an impostor,
512² near, in 12 ms slices back to back between frames (as the Milky
Way's), the near galaxy's first, the last ten kept.  The far points need
none.  Until a galaxy's map is in, its light stays on its point.

**Placed.**  The galaxies are an Object3D in the `StellarFrame`, in the
catalogue's frame as the stars are (metres from the Sun, J2000 ecliptic in
the scene's axes), so precession turns them with the stars.  The sky's
directions come from `galacticFrame.js` (`skyBasis`, the same turn as
`equatorialToSceneUnit`); a test puts Polaris, Vega and Sirius from their
J2000 RA and Dec within 0.05° of where `stars.dat` has them.  Points and
quads are relative to the eye (`rte.js`) and pinned just inside the far
plane, as the stars are.

**Going there.**  `Scene.goTo(galaxy)` is a star's travel: the world
rebased to the galaxy's centre, the camera on the star anchor, arriving
16.7 h_R out (4 h_R across 27° of a 45° field).  The zoom eases toward a
core of 0.05 h_R (`Scene.galaxyHome`), so the camera can fly into the disc.
The link's path is `galaxy:<SPARC name as a slug>` (`targetPath.js`), its
frame the galaxy's, as a star's (design/URLs.md).

### Cost

The far points are one draw of 176 points; the per-frame CPU work (176
distances, the levels of detail, the handoff attribute) is under 1 ms on
the sandbox (`?perf=1`'s `galaxies` row, 0.4-0.8 ms mean while turning at
NGC 2403).  A still view marches nothing; an impostor is 32²-256² rays when
the view turns; the near march is the Milky Way's cost while the camera
moves at a galaxy, and nothing while it's still.  The sandbox's SwiftShader
has no GPU timer and frames of 0.5-1 s whatever is drawn (the frame rate
was the same, 1.4-1.5 FPS, with the galaxies switched off with
`?perf=1&off=galaxies` and on, turning at NGC 2403), so the GPU cost needs
a real device: `?perf=1` on the preview at a galaxy, turning.  The toggle
`galaxies` (`off=galaxies`) hides them, to bisect by frame rate.

## Labels

`e` names the galaxies and `E` (Shift+E) the globular clusters, as in
Celestia.  In the link they are the settings `G` and `C` (design/URLs.md;
the keys can't be the letters, `e` being the equatorial grid's).

**What's named.**  A galaxy's label is the name it goes by (`commonName`):
its Messier number where it has one (M 63, M 109), else, for a galaxy SPARC
names from UGC, UGCA, ESO or PGC, its NGC or IC number (NGC 7217 for UGC
11914, IC 356 for UGC 2953), else SPARC's (DDO 154, not NGC 4789A).  The
search and the breadcrumb keep SPARC's name; every other is an alias.

**When.**  A galaxy is labelled when it's the target, whatever its
magnitude, or when its apparent magnitude from the camera is within one
magnitude of the limiting magnitude (`LABEL_MARGIN_MAG`;
`ThreeUi.limitingMagnitude()`, which follows the exposure, the stars'
setting and the field), checked every frame from where the camera is
(`apparentMagnitude`: the magnitude its far point draws, its face-on V
light at that distance through its own dust at that angle).  So the labels
are **on by default** and name nothing at the naked eye's limit: from the
Solar System the brightest, NGC 6946, is V 7.5 in the model (RC3's B_T
9.61, B−V 0.80, with the Milky Way's extinction taken out), NGC 300 8.0,
NGC 2403 8.3, M 63 8.6, all under the eye's 6.5.  Labelling all 175 would
mark 175 empty places on the sky.  As the limit deepens they come in: none
at 6.5, 12 at 8.5, 35 at `sm=3` (9.5), and through a telescope's field more.
A galaxy flown to is the target, so it is named however faint.

**Their light and their names follow different knobs.**  The stars'
setting (`[`, `]`, `sm=`) deepens the limit, so it brings in the galaxies'
names, but not their light: the galaxies take the exposure (`-`, `=`,
`ev=`) and a telescope's field, as extended light does (above, "Levels of
detail").  So at `sm=3` from the Solar System the names of 35 galaxies show
where their points are still under the eye's limit (in SwiftShader, toward
Ursa Major at a 60° field, the frame with the points and without differs
by at most 1 of 255).  The exposure brings the points up: at `ev=3` as well,
NGC 2403's is a faint point (17 of 255) and M 63's just over black (4),
and a telescope's field deepens both.

**How.**  One label sheet for the 175 (`SpriteSheet` with `pinFar`): each
label at its galaxy's centre, relative to the eye, drawn just inside the
far plane as the far points are (a galaxy's megaparsecs are past it), on
the overlay layer as the stars' labels are, in its own colour
(`GALAXY_LABEL_COLOR`, lavender, apart from the stars' blue).  A per-label
`shown` attribute, set by `_syncLabels` in the animation loop
(`preAnimCb`), hides the rest in the vertex shader.  The sheet is built the
first time the labels are wanted with a catalogue in, so nothing touches the
DOM on a test's path.  `V` (presentation mode) hides them with the other
annotations.

**Not yet.**  The labels aren't in the label declutter (#226, open as this
lands), so in the Ursa Major cluster at a deep limit they can overlap; they
join it once #226 merges.  A click on one doesn't target it yet: the
picking (`labelPick.js`) tests labels against the far plane, which these
are pinned inside of only in the shader.  The globular clusters have no
data: Harris's catalogue is [#228](https://github.com/celestiary/web/issues/228),
on this far-point renderer and this label path, and `E` has nothing to name
until then.

## Rotation curves

`curves.json` holds each galaxy's mass model, SPARC's Table 2: radius,
the observed circular velocity and its error, and the gas's, disc's and
bulge's velocities (the stars' at a mass-to-light ratio of 1 at 3.6 µm).
The targeted galaxy's info panel plots the observed curve against the
baryons' (`rotationCurve.js`; the plot is to move to a dark-matter app in
the widgets drawer, the catalogue staying a scene feature and its analysis
an app: [#233](https://github.com/celestiary/web/issues/233)): V_bar² = V_gas|V_gas| + Υ_d V_disk|V_disk| +
Υ_b V_bul|V_bul|, with SPARC's Υ_d = 0.5 and Υ_b = 0.7.  The gap between
them in the outer disc is the dark matter (NGC 3198's baryons give under
60% of its flat 150 km/s at 40 kpc; a test holds it).

**For #106's dark-matter toggle**: the same numbers are the potential.
V_bar(R) is the baryons' circular velocity, so a test particle at R in the
baryons' potential alone has v_c = V_bar, and with the halo v_c = V_obs; the
halo's contribution is V_halo² = V_obs² − V_bar² (or a fitted NFW, Li et al.
2020's fits, on the SPARC page).  The toggle swaps V_obs for V_bar as the
disc's rotation, and the arms (density waves with a pattern speed) and the
stars move in that field.  The galaxy's frame and spec are already where a
particle system would need them.

## Rebuilding the data

    NODE_USE_ENV_PROXY=1 node tools/sparc/buildSparc.mjs --cache /tmp/sparc-cache

It fetches SPARC's four files over HTTPS and, per galaxy, NED, SIMBAD's TAP
and VizieR (about 700 requests, under a minute; `--cache` keeps every
reply so a rerun fetches nothing).  Hosts: `astroweb.case.edu`,
`ned.ipac.caltech.edu`, `simbad.cds.unistra.fr`, `vizier.cds.unistra.fr`.
It prints the galaxies without a position angle; any that NED can't
resolve go in `meta.failed`.

## Evidence

[PR #223](https://github.com/celestiary/web/pull/223) has the renders
(headless Chromium on SwiftShader, 480×360 unless noted): NGC 2403 (Scd,
flocculent), NGC 3992 (M 109, SBbc), NGC 5055 (M 63, Sbc), UGC 2487 (NGC
1167, S0), DDO 154 (Im), NGC 4013 (edge-on Sb), each from the direction we
see it, north up and east left, for comparison with the survey images it
links (the sandbox can't fetch them); the Milky Way before and after; a
far view of NGC 2403's neighbours; the info panel's rotation curve.

The labels' evidence is on the PR: from Earth toward Ursa Major at `sm=3`,
and at M 109.

## Follow-ups

- The Milky Way's dust in front of galaxies behind it (the zone of
  avoidance): the far points and impostors aren't dimmed by our own dust.
- From inside the Milky Way the galaxies are drawn as the stars are, not
  through the eye's response to extended light (HDR.md): none is a
  naked-eye object, but a telescope's field of a large one would want it.
- Kinematic position angles and the near side from the HI velocity fields
  (SPARC's sources), and the arms' winding sense from images (Galaxy Zoo).
- Flocculence and arm number from images, not type, for the grand-design
  and flocculent exceptions (M 63).
- A boxy/peanut bulge for barred edge-on discs; off-centre Magellanic bars.
- The far points onto the point-population engine (#98) when it lands; and
  more galaxies past SPARC (#40) on the same model.
- The rotation curves' dynamics: #106.
- The labels through the declutter (#226), and picking one to target it.
- Globular clusters (Harris 2010) on the far points and labels: #228.

## Sources

- Athanassoula, E. 2005, MNRAS 358, 1477: boxy/peanut bulges from bars.
- Ballesteros, F. J. 2012, EPL 97, 34009: B−V to temperature.
- Bell, E. F. et al. 2003, ApJS 149, 289: colour and mass-to-light ratio.
- Comerón, S. et al. 2011, ApJ 741, 28: thick discs at 3.6 µm.
- de Grijs, R. 1998, MNRAS 299, 595: edge-on discs' scale heights.
- de Vaucouleurs, G. & Freeman, K. C. 1972, Vistas in Astronomy 14, 163:
  Magellanic spirals and irregulars.
- de Vaucouleurs, G. et al. 1991, RC3 (VizieR VII/155).
- Elmegreen, D. M. & Elmegreen, B. G. 1987, ApJ 314, 3: arm classes.
- Elmegreen, D. M. et al. 2011, ApJ 737, 32: arms at 3.6 µm.
- Erwin, P. 2005, MNRAS 364, 283: bar sizes.
- Fisher, D. B. & Drory, N. 2008, AJ 136, 773: bulges' Sérsic indices.
- Foyle, K. et al. 2010, ApJ 725, 534: star formation in and between arms.
- Fukugita, M., Shimasaku, K. & Ichikawa, T. 1995, PASP 107, 945: colours
  by type.
- Gadotti, D. A. 2011, MNRAS 415, 3308: bars' light and shapes.
- Hunter, D. A. & Elmegreen, B. G. 2004, AJ 128, 2170: star formation in
  irregulars.
- Kennicutt, R. C. 1981, AJ 86, 1847; Ma, J. 2002, A&A 388, 389: pitch by type.
- Kormendy, J. & Kennicutt, R. C. 2004, ARA&A 42, 603: pseudobulges.
- Kregel, M., van der Kruit, P. C. & de Grijs, R. 2002, MNRAS 334, 646.
- Lelli, F., McGaugh, S. S. & Schombert, J. M. 2016, AJ 152, 157: SPARC.
- Li, P. et al. 2020, ApJS 247, 31: halo fits.
- McGaugh, S. S. & Schombert, J. M. 2014, AJ 148, 77: Υ at 3.6 µm.
- Paturel, G. et al. 2003, A&A 412, 45: PGC 2003 (VizieR VII/237).
- Rémy-Ruyer, A. et al. 2014, A&A 563, A31: dust-to-gas against metallicity.
- Roychowdhury, S. et al. 2013, MNRAS 436, L104; Sánchez-Janssen, R.,
  Méndez-Abreu, J. & Aguerri, J. A. L. 2010, MNRAS 406, L65: dwarfs'
  thickness.
- Swaters, R. A. et al. 1999, MNRAS 304, 330; Zaritsky, D. et al. 2013, ApJ
  772, 135: lopsidedness.
- Xilouris, E. M. et al. 1999, A&A 344, 868: dust discs.
- Yoachim, P. & Dalcanton, J. J. 2006, AJ 131, 226: thick discs.
