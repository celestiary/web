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
| The limb glow | `atmos/Atmosphere.js` `newAtmosphere` |
| The field stars' colours (points) | `StarsBufferGeometry.js`, through the same blackbody table |
| The disc's brightness in exposure units, and the meter | [HDR.md, physical stars](HDR.md#physical-stars); `ThreeUI._luminousDiscs` |

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

`blackbodyColor(T)`: Planck's law through the CIE 1931 2° observer, as
the multi-lobe Gaussian fits of Wyman, Sloan & Shirley 2013 (within ~1% of
the tables), to linear sRGB (D65) at a luminance Y of 1. The colour is the
chromaticity only; the brightness comes from the catalogue's lumens (a
point) or the surface brightness (a disc). Channels may pass 1 (a hot
star's blue is 2): the buffer is linear HDR. Checked against CIE
illuminant A (a 2,856 K blackbody: within 0.002 in x and y) and the
Planckian locus's independent spline fit (Kim et al. 2002, within 0.004
from 1,667 K to 25,000 K). In 8-bit sRGB the Sun is (255, 241, 234), a
warm white; 6,500 K is white, as D65 nearly is.

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

## The limb glow

`newAtmosphere`'s shell at 1.07 radii takes the star's colour and
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
  by interferometry), and the Sun's own axis (it is drawn with the
  ecliptic pole's, 7.25° off).
- The chromosphere, prominences and flares (#167); the corona and the
  solar wind (#168).
- Pecaut & Mamajek's dwarf sequence for class V (its site isn't
  reachable from the sandbox either).
