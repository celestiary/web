# Stars from their physical parameters

One renderer for every star, the Sun its reference case
([#164](https://github.com/celestiary/web/issues/164)): a star's colour,
brightness, limb and surface come from its effective temperature, its
gravity and its activity, not from a recoloured Sun. This is the first
piece of the parametric body renderer (ROADMAP, *Shared engines*).

| Piece | Where |
|---|---|
| Temperature from class, colour, surface brightness, limb darkening, granulation and spot laws | `stellar.js` (pure functions, `stellar.test.js`) |
| A star's physical parameters: measured, or from its class and magnitude; rotation; activity | `starParams.js` (`starParams.test.js`) |
| The photosphere's parameters for one star | `Star.js` `photosphere(props)` |
| A catalogue star's disc when travelled to | `Scene.js` `showCatalogueStar` |
| The disc's shader | `star-shaders.js` |
| The eye's glare round the disc (it replaced the limb glow) | `sun/glare.js`, `sun/SunLayers.js` ([Sun.md](Sun.md#glare)) |
| The Sun's activity by date, chromosphere, prominences, flares, corona, CMEs, wind | [Sun.md](Sun.md) |
| The field stars' colours (points) | `StarsBufferGeometry.js`, through the same blackbody table |
| The disc's brightness in exposure units, and the meter | [HDR.md, physical stars](HDR.md#physical-stars); `ThreeUI._luminousDiscs` |
| Gaia's stars past the catalogue's: the same points, shader and photometry, tiled | [Gaia.md](Gaia.md) |
| How the catalogue loads: brightness tiers on the point-population engine | [Brightness tiers](#brightness-tiers), below; `catalogue/` |

## Temperature from class

The catalogue (Celestia's `stars.dat`) gives each star a spectral class,
subclass and luminosity class as indices (`StarsCatalog.js`;
`stellar.js` `SPECTRAL_CLASSES`, `LUMINOSITY_CLASSES`). Most of its stars
(61,579 of 106,748) have no luminosity class, and 2,320 no subclass.

- **O to M**: de Jager & Nieuwenhuijzen 1987 (A&A 177, 217), a
  20-coefficient double Chebyshev series in the spectral type and the
  luminosity class over the whole HR diagram (their eqs. 2a, 2b; the
  coefficients as PyAstronomy's `SpecTypeDeJager` carries them, which
  reproduces their Table 5's K0 V, log Teff 3.712). An unknown subclass is
  5; an unknown luminosity class is inferred from the absolute magnitude
  ([every star](#every-star-from-its-parameters)). Within 8% of every measured star in the test (the Sun,
  Sirius, Vega, Proxima, Arcturus, Rigel); it runs ~3% cool for G
  dwarfs (G2 V 5,590 K).
- **K1 to M5 supergiants and bright giants**: Levesque et al. 2005 (ApJ
  628, 973), 4,100 K at K1 I to 3,450 K at M5 I, from TiO bands fitted
  with MARCS models. DJ87's scale is a few hundred kelvin cooler there
  (Betelgeuse, M2 Ia: 3,056 K against a measured 3,600).
- **White dwarfs**: Teff = 50,400 K / subclass (the temperature index).
- **Wolf-Rayet**: 50,000 K, the table's top; past ~20,000 K a blackbody's
  colour hardly changes.
- **Carbon and S stars, L and T dwarfs**: approximate ranges (see
  `teffFromClass`); 177 catalogue stars, no L or T.
- **The Sun**: 5,772 K (IAU 2015 Resolution B3), by name or HIP 0. A
  star's own `teff` overrides its class, and the measured stars'
  (`starParams.js` `MEASURED_STARS`) theirs.

## Colour

`blackbodyLinearColor(T)`: Planck's law through the CIE 1931 2° observer,
as the multi-lobe Gaussian fits of Wyman, Sloan & Shirley 2013 (within ~1%
of the tables), to linear sRGB (D65) at a luminance Y of 1. The colour is
the chromaticity only; the brightness comes from the catalogue's lumens (a
point) or the surface brightness (a disc). Checked against CIE
illuminant A (a 2,856 K blackbody: within 0.002 in x and y) and the
Planckian locus's independent spline fit (Kim et al. 2002, within 0.004
from 1,667 K to 25,000 K). In 8-bit sRGB the Sun is (255, 241, 234), a
warm white; 6,500 K is white, as D65 nearly is.

**What is drawn is the chromaticity in stored values**
(`blackbodyColor(T)`, [#235](https://github.com/celestiary/web/issues/235)):
the linear colour through sRGB's transfer function, normalised to a luma
of 1 over the stored values, so a star's light scales it linearly.  The
pipeline never encodes or decodes sRGB ([HDR.md, colour
spaces](HDR.md#colour-spaces-stored-values)): a texture's stored values
are lit linearly and shown as they are, and the galaxy's colours are
given in stored values (`galaxyModel.js` `COLORS`).  The linear
chromaticity shown as stored values, which the stars and the discs were
until #235, is about twice as saturated as the blackbody at the display:
a 3,000 K star showed (255, 123, 39), a deep orange, where its colour is
(255, 185, 110), a pale one; the Sun (255, 224, 210) where it is (255,
241, 234); a 20,000 K star (104, 137, 255) where it is (171, 193, 255).
The eye sees the brightest stars' colours as pale tints (Betelgeuse's
orange, Rigel's blue-white), which the stored colour gives.  Channels may
pass 1 (a hot star's blue is 1.3): the buffer is linear HDR, and the tone
map takes them.  The disc shader's granulation, spots and limb darkening
multiply the stored colour by linear ratios, as a texture is lit.

The shader interpolates a 64-entry table (`blackbodyLut`, log-spaced from
1,000 K to 50,000 K: colour, and log2 of the luminance over the Sun's),
passed as the uniform array `uBlackbody`; the field stars read the same
table (`blackbodyFromLut`), so a star is the same colour as a point and as
a disc. The table is within 1% of the function.

This replaces two hand tables: the shader's piecewise RGB fit of a
spectrum chart, with ad hoc temperature ranges per class (`tempRanges`: G
was 5,778 K to a quarter of it; the rest "like M"), and the field stars'
16 colours picked off a chart (`StarSpectra`). The unreferenced
`shaders/star.frag` and `star.vert` are gone.

The PR carries a colour swatch: each class's temperature and colour
beside the Kim locus's colour at that temperature, and the measured
stars' class temperatures against their measured ones.

## Surface brightness: luminance, not σT⁴

A disc's mean radiance is the Sun's (`SUN_DISC_RADIANCE`, HDR.md) times
`blackbodyLuminance(T)`: the blackbody's luminance over one at the Sun's
temperature. A display shows luminance, the scene buffer's unit, so this
is the visual analogue of σT⁴, which counts the light the eye doesn't see:

| Star | Teff (K) | Luminance / Sun's | (T/T☉)⁴ |
|---|---:|---:|---:|
| Proxima (class M5 V) | 3,060 | 0.019 | 0.079 |
| Betelgeuse (M2 Ib) | 3,660 | 0.076 | 0.16 |
| Sun | 5,772 | 1 | 1 |
| Sirius (A1) | 9,774 | 6.7 | 8.2 |
| Vega (A0 V) | 10,205 | 7.6 | 9.8 |
| 20,000 K | | 34 | 144 |

`stefanBoltzmannRatio` is there for the bolometric uses (the radius,
below).
The meter (`luminousDiscGain`) reads each star's own radiance
(`Star.discRadianceRelSun`), so a hot star's disc is stopped down more
than the Sun's and a red dwarf's less, and the glow shell takes the
star's colour and radiance.

## Limb darkening

Per sRGB channel, by temperature: the emergent intensity of a grey,
plane-parallel LTE atmosphere in the Eddington approximation,
I_λ(μ) = ∫ B_λ(T(τ)) e^(−τ/μ) dτ/μ with T⁴(τ) = ¾ Teff⁴ (τ + ⅔) (Gray
2005, ch. 9), through the CIE observer to linear sRGB at μ = 1, ½ and 0,
matched there by the power-2 law I(μ)/I(1) = 1 − c(1 − μ^α) (Hestroffer
1997; Maxted 2018, whose h1 = I(½) and h2 = I(½) − I(0) fix c and α).
The shader divides the law by its disc mean, 1 − cα/(α + 2), so the
disc's mean radiance, which the meter and the point sprite assume, is
unchanged. Integrated over wavelength the grey atmosphere gives
Eddington's (2 + 3μ)/5 (tested).

| Star | Teff | limb / centre, R G B | α, R G B |
|---|---:|---|---|
| Proxima | 3,060 | 0.14 0.10 0.04 | 1.24 1.38 1.68 |
| Betelgeuse | 3,660 | 0.21 0.15 0.08 | 1.10 1.22 1.43 |
| Sun | 5,772 | 0.39 0.33 0.25 | 0.90 0.95 1.05 |
| Vega | 10,205 | 0.58 0.54 0.47 | 0.79 0.81 0.85 |

The limb darkens more in blue and in cooler stars, as observed, so the
Sun's limb reddens. **Not Claret's tables yet**: the plan was Claret's
coefficients from model atmospheres (Claret 2000; Claret & Bloemen 2011),
but VizieR and CDS are not reachable from the sandbox. The grey law is
close for the Sun (its visible limb is ~0.3-0.45 of its centre) and hot
stars, but darkens a cool star's limb more than a model atmosphere does:
an M dwarf's in V is nearer 0.2-0.3 of its centre than 0.10. Swapping in
Claret's per-band coefficients is a table in `limbDarkening`, the shader
unchanged.

## Granulation, at three scales

Convection cells (Worley's F1 and F2 of a jittered 3D lattice whose
points wander with the noise time, slightly domain-warped): bright
granule centres, dark lanes where F2 − F1 is 0, normalised to a mean of 0
and an rms of 1 (the constants measured over 3×10⁵ points of the same
field). Three layers, each a temperature fluctuation δT/T:

- **Granules**, `uGranuleFreq` across the radius: the Sun's 535 (a 1.3 Mm
  cell in 696 Mm). Their size follows the pressure scale height,
  H_p ∝ T/g (Freytag et al. 1997; Trampedach et al. 2013), so a star's
  count is the Sun's × (R/R☉)(g/g☉)(T☉/T): `granulesPerRadius`, at least
  1.5 (a supergiant's few giant cells), the gravity and radius from
  `starParams.js`: Proxima 820 across its radius, Betelgeuse 20.
- **Mesogranules**, 5× the granules' size, 0.3 of their amplitude.
- **Supergranules**, 25×, with almost no intensity of their own in the
  Sun (0.03 of the granules'), more at low gravity, and their boundaries
  the bright **network**, toward the limb.

The amplitude is the rms intensity contrast over d ln Y / d ln T
(`luminanceSlope`, 4.4 at the Sun's temperature), so the fluctuation is a
blackbody's at each fragment's temperature: hot granules bluer, lanes
redder. The contrast by temperature (`GRANULATION_CONTRAST`) follows 3D
convection simulations (Magic et al. 2013; Tremblay et al. 2013): 0.15
for the Sun, peaking ~0.19 in the F stars, ~0.03 for M dwarfs, and zero
from ~8,300 K, where the convective envelope is gone (Vega and Sirius are
smooth), ×1.6 at log g 0. These are approximate readings of the
simulations' trends, not a table fit.

Band-limited as before (#165's follow-up): each layer fades out as its
cells near a pixel (6 px down to 2.5 px a cycle), so the Sun's disc from
1 AU, or a guide disc, is smooth, and the granules come in as they
resolve: from about 0.1 R☉ over the surface at 45°.

## Spots and faculae

The Sun's own spots are its active regions by date, from the sunspot
number, in their cycle's zone, turning with the surface (region mode:
[Sun.md, spots](Sun.md#spots-the-active-regions)); every other star's
are the lattice below.

**Active regions** are a smooth field over the star above a threshold
(the seed's `uSpotBias` moves it), in a band of latitude: the Sun's
5°-35°. **Spots** sit in them: a lattice of 25 cells across the radius,
each cell in an active region holding a spot with chance 0.35, of radius
up to 0.45 cells (12 Mm), shrunk where the region is weak. Each has an
**umbra** inside 0.42 of its radius, Teff − ΔT, and a **penumbra**
outside, Teff − ¼ΔT, with filaments where resolved; ΔT by temperature
from Doppler imaging and molecular bands (Berdyugina 2005, fig. 7):
1,700 K for the Sun (~4,000 K umbrae), ~300 K for M dwarfs. Through the
blackbody the umbra is dark and red. A spot's edge is softened over a
pixel, and spots under a few pixels fade, rather than turning to blocks
of the 2×2 quads the derivatives are taken over.

**Faculae** brighten the active regions, round the spots most, as a
temperature rise times (1 − μ)²: nothing at disc centre and 15% at
μ = 0.2, as the Sun's do. Above 7,000 K a star has no convective
envelope, so no granules, spots or faculae (Ap stars' chemical spots
aside); spots by type are below.

## The limb glow (replaced by the glare)

The shell is gone ([#168](https://github.com/celestiary/web/issues/168)):
a ring of the disc's own radiance to 1.07 radii that no eye or camera
sees, which would have shown round the Moon in totality.  The eye's
veiling glare, from the CIE's equation and scaled by what's seen of the
disc, stands in its place ([Sun.md, glare](Sun.md#glare)).  What it was:
`newAtmosphere`'s shell at 1.07 radii took the star's colour and
radiance. It was drawn through the disc's limb from far off: from tens of
gigametres the depth buffer can't tell the disc from the shell 0.07 radii
behind it (its resolution there is ~1e8 m), so the glow added in blocks
round the limb (the Sun from 1 AU at a 1° field, before and after this
change). The shell now drops any fragment whose ray passes within the
disc's radius of its centre, the closest approach taken as a cross
product, which keeps its precision where the ray points at the centre.

## Every star from its parameters

[#166](https://github.com/celestiary/web/issues/166): `starParams(props)`
gives every star its temperature, radius, mass, gravity, rotation and
activity, and the photosphere is drawn from them, so a catalogue star is
the same renderer as the Sun with its own numbers.

**Measured stars** (`MEASURED_STARS`, by HIP) take their published
values:

| Star | Teff (K) | R (R☉) | M (M☉) | log g | Granules / R | Rotation | Spots | Sources |
|---|---:|---:|---:|---:|---:|---|---|---|
| Sun | 5,772 | 1 | 1 | 4.44 | 535 | (slow; not modelled) | the Sun's, in the belts 5°-35° | IAU 2015 B2, B3 |
| Sirius A | 9,845 | 1.714 | 2.063 | 4.28 | none (radiative) | slow | none | Davis et al. 2011; Bond et al. 2017 |
| Vega | 10,060 pole, 8,152 equator | 2.362 pole, 2.818 equator | 2.15 | 4.02 | none | pole-on, i = 4.98°; β 0.25 | none | Yoon et al. 2010 |
| Altair | 8,450 pole, 6,860 equator | 1.636 pole, 2.029 equator | 1.791 | 4.26 | 449, weak | i = 57.2°, PA −61.8°; β 0.19 | none | Monnier et al. 2007 |
| Betelgeuse | 3,600 | 764 | 18 | −0.07 | 20 (giant cells) | slow | none (no solar-type dynamo) | Levesque & Massey 2020; Joyce et al. 2020 |
| Proxima Cen | 2,980 | 0.1542 | 0.122 | 5.15 | 820 | slow (83 d) | flare star: many, large, all latitudes | Ribas et al. 2017; Boyajian et al. 2012 |

**Every other star** from the catalogue:

- **Luminosity class**: the catalogue's where it has one, else DJ87's
  continuous b at which its luminosity for the star's type, through the
  bolometric correction, gives the star's absolute magnitude
  (`inferLuminosityB`): Polaris, F7 with no class, comes out b 1.6, a
  supergiant (it is F7 Ib). A star at or under its type's dwarf magnitude
  is a dwarf.
- **Temperature** from the class and b (above).
- **Radius by Stefan-Boltzmann**, R = √L (T☉/T)², L the bolometric
  luminosity from the absolute magnitude and the bolometric correction
  (`bolometricCorrectionV`: Flower 1996 with Torres 2010's coefficients).
  It was √L_V, the visual luminosity's square root, which leaves out the
  temperature: Betelgeuse was 115 R☉ (it is 764), Proxima 0.01 (0.15).
  Within a factor of 2 of eight interferometric radii (tested: Rigel
  73 against 79, Arcturus 23/25, Procyon 2.0/2.05, Tau Ceti 0.86/0.79,
  Spica 7.2/7.5, Canopus 74/71, Polaris 50/46, Aldebaran 36/44). Late M
  dwarfs come out large: the bolometric correction's cool end is fitted
  to giants (Barnard's Star 0.32 against 0.19). The catalogue's `radius`
  (the goTo distance, the point's fade into its disc) and `teff` are set
  from these as it loads (`StarsCatalog.read`, ~0.2 s for 106,748
  stars).
- **Mass** from the main-sequence mass-luminosity relation
  (`massFromLuminosity`), rough for evolved stars (Arcturus 4 M☉ for its
  ~1); the gravity it gives enters the granule size as a power, so a
  factor of 4 in mass is one of 4 in the cells' size.
- **Spots by type** (`spotsByType`; Berdyugina 2005, Strassmeier 2009):
  none for hot stars or supergiants; a few for giants; the Sun's for G
  dwarfs; more, to 60° latitude, for K dwarfs; and for M dwarfs large
  ones (8 lattice cells across the radius, not 25) at all latitudes,
  poles included, over much of the star, more for a known flare star. The
  umbra's contrast falls with temperature, so an M dwarf's spots are
  many but shallow.

**Rotation** where measured (Vega, Altair): the Roche model through the
pole and the equator, Ω² = 2(1 − 1/e)/e² in units of GM/R_pole³ (e the
equator over the pole), the disc an oblate spheroid, and gravity
darkening T = T_pole (g_eff/g_pole)^β (von Zeipel 1924), β from the two
measured temperatures (Vega's comes out 0.250, von Zeipel's) or as
published (Altair's 0.19). The shader computes g_eff per fragment
(`gravityDarkening`, mirrored by `effectiveGravity`); the star's colour
and mean brightness are its area-weighted mean T⁴'s (Vega 8,914 K,
Altair 7,529 K). The axis is set from the inclination and position angle
against the line of sight from the Sun and the celestial north pole in
the catalogue's frame (`rotationAxis`, `CATALOGUE_NORTH`: the frame is
the J2000 ecliptic with the scene's axes, so the pole is
(0, cos ε, −sin ε); Polaris is 0.7° from it), so Altair from the Sun's
side shows its measured tilt; in the guide, as seen from Earth with
north up. The glow shell is scaled and turned with the disc.

**Approaching any catalogue star** (`Scene.goTo(star)`) draws its disc:
`showCatalogueStar` builds a `Star` from its props in the stellarFrame,
where the catalogue puts it, one at a time (the next replaces it), with
no light (the Sun's point light and shadows stay the Sun's). It is in
the scene's objects as `catalogue star <HIP>`, so the meter stops down
for its disc as for the Sun's (`_luminousDiscs`), and the zoom
approaches its surface and stops there (`ThreeUI._homeBody`): the floor
was the last targeted body's radius, which kept the camera 6 radii from
Proxima and let it into Betelgeuse.

## Names

A star's name shows while the star can be seen and the names are on (`l`):
how many is decided by what's visible, then by the user's choice of
magnitude, then by the declutter (the maintainer's rule, PR #301).

- **Which have one:** every named star in `starnames.dat` (3,369), and the
  luminous unnamed by HIP number (`LUMINOUS_LABEL_ABS_MAG`), on one sheet
  (`showLabels`).  Before, only the 290 or so with three names or more were
  on it, all drawn wherever their stars were, seen or not.  The Sun has its
  body's name.
- **Wanted each frame** (`_syncLabels`, `sheet.wanted`): a star's name while
  its apparent magnitude from the camera is within the limiting magnitude
  (`ThreeUI.limitingMagnitude`: the exposure, the user's star setting, `[`
  and `]`, and the field of view), and the target star's always.  So none
  in daylight or with a sunlit body in the frame, the bright ones under a
  city's sky, hundreds at a dark site.  Scene gives the limit and the target
  (`labelState`); without it (the guide's scene) every name is wanted.
- **Then the declutter** ([DESIGN.md, declutter](../../DESIGN.md#declutter)):
  the wanted take part, the brighter winning, below every place's name, a
  shown one holding its place.
- **Their look** ([DESIGN.md, label styles](../../DESIGN.md#label-styles),
  `STAR_LABELS`): from the brightest wanted name in view, 13 px and full
  brightness, to the faintest, 9 px and 0.7, by magnitude, at least a
  magnitude between the ends; eased over a few frames; faded in and out.
- **Checked** (headless Chromium, the same frames against `main`): at New
  York's shore at night (`#sun/earth@40.5159,-74.0352,-30m;t=9793.733225jd;…`,
  names on) the limit is 1.7, and Castor, Pollux and Procyon are named where
  `main` named 30 stars in view, most of them unseen
  (`screens/labels/star-names-visible.png`).  The limit forced to 6.5 in the
  page: 250 wanted, 53 shown after the declutter
  (`screens/labels/star-names-limit-6.5.png`).  From 5 million km with the
  sunlit Moon targeted, the limit is -6.4: no star is drawn, and none is
  named.

## Brightness tiers

[#259](https://github.com/celestiary/web/issues/259), leaner first load 3
of [#256](https://github.com/celestiary/web/issues/256).  The catalogue,
`stars.dat` (106,747 stars, 2.13 MB, which as binary gzips only to
1.85 MB), was one request the first load waited for: 1,848 KB of the
homepage's 2,614 KB at scene-ready.  It is now loaded as brightness tiers
on the point-population engine Gaia's stars use ([Gaia.md, the
engine](Gaia.md#the-engine)): the same HEALPix-by-magnitude tiles, with
the catalogue's own columns.  The naked-eye sky and every star the app
names arrive first, in one request of 157 KB, and the rest stream in
after the scene is on screen.

| Piece | Where |
|---|---|
| The tier rule and its constants | `catalogue/tiers.js` |
| The build, stars.dat and starnames.dat to tiles, packs and a manifest | `catalogue/build.js`; `tools/stars/build.mjs` (`yarn stars`) |
| The freshness test, and the tiers against stars.dat | `tools/stars/stars.test.js` |
| A tile to its stars (StarProps) and its points' attributes | `catalogue/catalogueTile.js` (`StarsCatalog.js` `catalogueStar`, `StarsBufferGeometry.js` `starAttributes`, shared with stars.dat's path) |
| The population: fetched whole, drawn whole | `catalogue/cataloguePopulation.js`; the engine's `complete`, `drawAll`, `holdRest` and packs (`points/PointPopulation.js`, `points/tileFormat.js`) |
| Loading, readiness, a star's wait, picking's index, the fallback | `Stars.js` |
| The check in the app | `tools/stars/tierCheck.mjs` |

**The tiers** (`public/large/stars/v1/`, Git LFS, through `dataUrl()`):

- **The bright tier is the tree's 12 roots**, which hold, however many
  that is, every star to V 6.5 from the Sun (8,746: the naked-eye sky)
  and every star the app names or labels whatever its magnitude: the
  stars of `starnames.dat` (Proxima, V 11, the Gliese stars), the
  favourites (`FAVES`) and the very luminous stars the label sheet names
  by number (M < −5).  134 are fainter than 6.5, so 8,880 in all: 196 KB,
  157 KB gzipped, one pack (`packs/roots.bin`).  The tile tree takes a
  rule for its roots for this (`tileTree.js` `rootsHold`), and a root's row
  carries a ninth number, `magSub`, the brightest star below it (6.5), so
  the selection still knows its children are fainter than the naked eye's
  limit although the root holds Proxima; a plain tree's rows (Gaia's) are
  as before.
- **The rest**, 97,867, go down the tree from order 1 as Gaia's do (4,096
  a tile): they fill order 1 alone, 48 tiles of 1,100 to 2,800.  They
  travel as 12 packs, one per root cell (its descendants), 128-179 KB
  gzipped each, so a view's own part of the sky comes first.
- **The columns**: the tile format's positions (the float32 light-years
  stars.dat stores), absolute V (its 1/256 mag steps, exactly), Teff 0
  (from the class, as stars.dat's reader takes it) and two new optional
  columns, the HIP number and the packed spectral class (`HAS_HIP`,
  `HAS_CLASS`; 22 bytes a star).  A star from a tile is made by the same
  function as one from stars.dat (`catalogueStar`), and its point by the
  same one (`starAttributes`): `stars.test.js` checks that every star of
  stars.dat is in the tiles once, equal to stars.dat's.
- **Packs** (`tileFormat.js` `encodePack`): several tiles in one file,
  each its own tile still, for the selection and the draw.  14 requests
  with the manifest for the whole catalogue, against 60 a tile; 2.35 MB,
  1.81 MB gzipped (stars.dat's 1.85 MB).

**What loads when** (`Stars._loadTiers`):

1. The manifest (4 KB) and `starnames.dat` (25 KB gzipped), at once.
2. The bright tier's pack, alone (the engine fetches nothing else until
   the roots are in), with the stars' shader beside it (stars.dat's
   shader waited for the whole file).  The catalogue is then **ready**
   (`onCatalogReady`): the label sheet, the asterisms, the search's stars
   and every named star are built from it.
3. **Scene-ready** (`Stars.drawn`, which `ThreeUi.sceneReady` and the
   meter's `frameCanBeEmpty` ask): the bright tier and its shader, and
   every tile the view wants, to its limiting magnitude plus the engine's
   margin (`PointPopulation.viewReady`).  By the Sun (the homepage, whose
   limit is far brighter than 6.5 with the Sun in the frame) that is the
   bright tier alone; a dark-adapted view at the naked eye's limit, or a
   deep or telescope link, waits for its field's faint packs.  The margin
   counts: at the naked eye's limit, stars past 6.5 are a quarter of a
   field's light (below), so a reveal without them would show them pop in.
   An earlier cut waited only for tiles that could hold a star over the
   limit itself; the measurement below is why it went.  Latched: once
   drawn, a later view wanting a tile on its way isn't the scene loading
   again.
4. **The rest**, after the reveal (`Celestiary.frame` calls
   `Stars.revealed`, which streams them, beside `loadEphemeris`), or when
   something needs a star that isn't in (below); a scene no one reveals
   (the guide's) has them 3 s after its stars are drawn
   (`STREAM_REST_AFTER_MS`).  Four packs at a time, the view's first,
   then the brightest.  **Each fades in** (below).  The catalogue is then
   **complete** (`onCatalogComplete`, `whenComplete`).

**The fade-in.**  On the preview the maintainer saw the faint tiers
arrive as "a pretty perceptible pop".  Measured (`tools/stars/fadeCheck.mjs`,
headless, a dark field 4.7 AU over the Sun looking away from it): with
the frame held at the dark-adapted gain, the field's mean luminance went
from 0.704 to 0.848 of 255, +20%, in one frame as the first packs landed;
with the meter running it stayed at its dark-adapted cap (4e6) through
it, so the pop was the light itself, not the meter.  The reveal didn't
hide it: the reveal waits for the tiles the view wants at the limit then,
and a link's meter dark-adapts only after it (the gain is 1 at the
reveal), so the faint tiers arrive while the eye adapts.  Now every tile
that lands after the reveal fades its light in over 1.8 s
(`PointPopulation.fadeGain`, `FADE_IN_MS`): a gain from 0 to 1,
smoothstep, on the stars' flux (`uTileGain` in `stars.vert`, set by each
tile's draw on the shared material), so a fading star is a fainter star
in the additive HDR buffer, its sprite following the same law, not a
transparent one.  Tiles that landed before the reveal (the bright tier,
and a view's own faint tiles a link waits for) are at full light: the
reveal fades the whole scene in (`PointPopulation.markShown`, called by
`Stars.revealed`).  Tiles that come later as the view moves (a telescope,
a flight out) fade in the same way, and so do Gaia's, which share the
engine.  The same field after it, on a 20 fps clock: the light rises
from 0.704 to 0.848 over 1.9 s, at most 0.008 a frame; the meter, at its
cap, doesn't move.  Where a meter isn't at its cap it follows the rise as
it follows any light, eased over its 0.75 s (1.5 s when measured).

**Every consumer, across the tiers:**

| Consumer | What it gets |
|---|---|
| Names (`starnames.dat`, `hipByName`, `getNameOrId`) | Every name from step 1; every named star is in the bright tier |
| The search (`StarsProvider`) | Every named star from the bright tier: the index built then is whole (`tiers.test.js`).  `HIP 46635`, a faint unnamed star, once its tier is in: the search's first query asks for the rest (`SearchIndex.loadOnSearch` → `whenComplete`), the index is marked stale at completion so a query already asked is asked again, and the homepage's Enter (`ensureSearchable`) waits for it |
| The label sheet (`showLabels`), the target's label | Built once, at ready: its every star is in the bright tier (the favourites throw without theirs; the Sun is added before the roots arrive) |
| The asterisms | Built at ready; their stars are found by name, so are in the bright tier (`stars.test.js` checks all 861 members) |
| Picking (`PickLabels`, `Picker.queryPoints`) | An index over the stars loaded so far (`Stars.pickIndex`), rebuilt when the catalogue has grown (`StarsCatalog.version`): a faint star can be picked once its tier is in |
| A link or a frame to a star (`#hip:N`, `from=hip:N`: `Celestiary._whenStar`) | `Stars.whenStar`: at once for a star in, else when its tier lands, asking for the rest at once; missing only once every tier is in.  A link to a faint unnamed star waits about as long as stars.dat took (`Celestiary.test.js`, "a link to a faint star") |
| The label sheet's order | HIP order, as stars.dat had it, so overlapping labels draw as before |
| The human expansion (`Colonization.js`) | Needs every star: waits for complete, and asks for it |
| Gaia's merge (`gaia/dedup.js`) | Built against stars.dat, which the tiers hold exactly; `stars.test.js` also re-runs the merge's position test on Gaia's 49,152 brightest against the tiers' stars: no match |
| The homepage's tour | No star targets; its stars leg (96-132 s) is long after completion |
| The Sun's point (HIP 0, not in stars.dat) | Its own one-point geometry with the catalogue's material, which also carries the camera to the labels' RTE uniforms as the one geometry's points did |
| `ThreeUi.starProbe`, `starsDebug` | `Stars.pointOf` (the tile drawing a star), `Stars.pointsMaterial` |
| About | The stars in so far |
| `tools/gaia/skyCheck.mjs` | `starTiers=0`: it hides and shows the one geometry against Gaia's |

**Drawing**: every point of every loaded tile in the field (`drawAll`),
as the one geometry drew every star; tiles out of the field aren't drawn,
the field padded by a sprite's reach (`EDGE_PAD_PX`) as Gaia's.  Not the
engine's cut at the limit plus the margin: that would take out the
sub-threshold stars' summed light, which the Milky Way's diffuse light is
fitted against ([MilkyWay.md, double counting](MilkyWay.md#double-counting)),
a separate decision.  A draw call a tile in the field (7 to 24 in the
views measured, of 60) and the Sun's, where the geometry was one.

**The fallback** (PLAYBOOK, *Keep the fallback path*): `?starTiers=0`, or
no manifest, or a pack that fails, reads stars.dat whole as before
(`_loadWhole`; what the tiles brought is replaced, not drawn twice).  The
guide's star page reads stars.dat itself.  stars.dat and starnames.dat
stay in `public/data/` as the tiers' source: Gaia's build and the tests
read stars.dat too.

**Why the engine, and what was set aside:**

- **A plain magnitude split** (stars.dat cut into two or three files by
  V): the least code, one geometry a file.  But a second scheme beside
  Gaia's: no culling by field, a deep link waits for every faint star,
  and nothing to put the catalogue and Gaia in one tree later.  On the
  engine the catalogue is the top of the same pyramid.
- **The engine as Gaia uses it** (only what the view wants, evicted when
  not): the catalogue is what the names, the search, picking, the labels
  and the expansion resolve against, so it is held whole (`complete`).
- **Gaia's count-capped roots** (each root its cell's brightest 4,096):
  49,152 stars, and a limit that varies with the cell's density; a rule
  makes the bright tier exactly the naked-eye sky.
- **The bright tier by magnitude alone**: a search for Proxima, the
  favourites' labels and Gliese 1 would wait for the faint tiers; the 134
  named or labelled stars past 6.5 cost 3 KB.
- **A bright tier to 7.5** (the engine's margin), about 22,000 stars and
  400 KB for every first load: the margin's stars matter only where the
  view is dark-adapted, and there scene-ready waits for that field's
  faint packs.
- **A request a tile** (60), or **one file for the rest**: packs by root
  cell keep the bright tier one round trip and give a deep link its
  twelfth of the sky first.
- **The rest at once**: it shared the first load's bandwidth with what the
  reveal needs (measured: all 13 packs in by scene-ready); held to the
  reveal, or a need, it doesn't.

**Evidence** (`tools/stars/tierCheck.mjs`, headless Chromium on
SwiftShader, 480×300, Gaia's stars off, each view held at one exposure
across its states): three views, each rendered with only the bright tier
in (the faint packs held unanswered), with every tier in, and on `main`
(stars.dat, one geometry), compared pixel by pixel (luminance, 0-255):

| View | Limit | Every tier against main | Bright tier only against every tier | Naked-eye stars in the field, drawn from the bright tier |
|---|---:|---|---|---:|
| 90° away from the Sun, 4.7 AU over it, dark-adapted (4e6) | 5.16 | 11 of 144,000 pixels differ, by at most 0.3 | 85% of the light; 278 pixels differ by more than 8, at most 26 | 1,964 of 1,964 |
| The same at 45°: the naked eye's limit | 6.50 | 10 pixels, at most 0.3 | 73% of the light; 1,274 pixels by more than 8, at most 50 | 805 of 805 |
| Orion with the stars' labels and the asterisms, metered (gain 609) | −3.1 | identical | identical | 886 of 886 |

Once in, the tiers draw main's frame (the last few pixels at 0.3 of 255:
the drawing order of additive points, and stars.dat's last star, HIP
120404, which the one geometry dropped by sizing its arrays to the file's
count and then adding the Sun).  The bright tier alone draws every
naked-eye star of the field, and, where the exposure shows them, lacks the
fainter stars' light: which is why scene-ready waits for the margin's
tiles.  The label sheet is built in HIP order (stars.dat's), so labels
that overlap draw as they did; the first run, in the tiles' magnitude
order, differed there.

The homepage (`yarn load-budget`, the built site served as Pages serves
it): scene-ready after 1.4-2.0 s, 26 requests and 917-928 KB (from 1.6 s,
25 and 2,614 KB), the manifest at about 1.0 s, the bright tier requested
at about 1.5 s; the 12 faint packs at the reveal, all in about 0.5 s
later on the local server (in SwiftShader the homepage's reveal waits for
its meter, so about 5 s from navigation); settled 39 requests, 3,918 KB
(from 26, 3,948 KB).

**Rebuilding.**  After editing `stars.dat` or `starnames.dat`:

    yarn stars          # rewrites public/large/stars/v1/ (bun, about 0.2 s)
    yarn stars --check  # exits 1 if the tiers are stale
    git add public/large/stars/v1   # Git LFS (public/large/**); git lfs ls-files to check

`tools/stars/stars.test.js` (in `yarn precommit`) fails when they have
drifted, and skips that check, saying so, in a checkout whose tiers are
LFS pointers.  The manifest records both sources' SHA-256.

## Evidence (PR #21's)

Rendered on SwiftShader, 480×360, labels and orbits off, the meter
settled: the Sun in the app from 1 AU at a 1° field, 10, 3 and 1.6
radii (at the limb), 1.1 and 1.02 radii (granules); the guide's Sol,
Vega, Sirius, Betelgeuse and Proxima at 90% of the canvas; before and
after. Paths are in the PR.

## Evidence (PR #166's)

Approached in the app, 3 radii from each on the Sun's side (the view
from Earth), the meter settled: Betelgeuse, Altair, Sirius, Proxima, the
Sun and Vega; and the guide's Sol, Vega, Sirius, Betelgeuse, Proxima and
Altair, against #21's. Paths are in the PR.

## Follow-ups

- Claret's limb darkening (needs VizieR or CDS reachable).
- A dwarf-specific bolometric correction for late M dwarfs (Pecaut &
  Mamajek's, or Mann et al. 2015's), whose radii come out large.
- Rotation for more stars (Regulus, Achernar, α Cep, α Oph: all imaged
  by interferometry).  The Sun's own axis is done: its photosphere turns
  in the Carrington frame, by the IAU's pole and W (Sun.md).
- The chromosphere, prominences, flares, the corona and the solar wind
  are done for the Sun ([Sun.md](Sun.md)); other stars' activity (an M
  dwarf's flares, a corona by activity) is a follow-up.
- Pecaut & Mamajek's dwarf sequence for class V (its site isn't
  reachable from the sandbox either).
