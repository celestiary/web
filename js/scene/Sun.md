# The Sun's dynamic layers, corona and wind

The Sun past its photosphere ([#167](https://github.com/celestiary/web/issues/167),
[#168](https://github.com/celestiary/web/issues/168)), on the star renderer
of [#164](https://github.com/celestiary/web/issues/164) ([Stars.md](Stars.md)):
its activity by date, the active regions and their spots, white-light
flares, the chromosphere, prominences, the K-corona and CMEs, the solar
wind, eclipses, and the eye's glare.  The rule is the HDR pipeline's
([HDR.md](HDR.md)): every brightness is a ratio to the disc's mean radiance
(B☉), so in exposure units it is that times `SUN_DISC_RADIANCE` (69,357 at
Earth's keyed exposure) times the frame's gain; every rate and size is a
published one, cited, or says it is a model.  Everything follows the
simulated date and a seed, with no history: a permalink reproduces the
Sun it shows.

| Piece | Where |
|---|---|
| The sunspot number by date: SWPC's observed and forecast series, the cycle model, Spörer's law, differential rotation | `sun/solarCycle.js`, data `sun/sunspots.json` (`tools/sun/sunspots.mjs`) |
| The active regions (sunspot groups): emergence, growth, decay, rotation, their two spots | `sun/activeRegions.js` |
| Flares, CMEs, prominences: seeded Poisson processes in time bins | `sun/solarEvents.js`, `sun/sunRandom.js` |
| Balmer emission's colour and level; a white-light flare's contrast | `sun/emission.js` |
| The K-corona: electron density, Thomson scattering, the current sheet; a CME's electrons | `sun/corona.js` (JS and GLSL) |
| How much of the disc a camera sees (eclipses); the sky in totality | `sun/eclipse.js` |
| The eye's veiling glare (CIE) | `sun/glare.js` |
| The Sun's IAU frame, Carrington's | `sun/sunFrame.js` |
| The layers as three.js objects, per frame; the coronagraph probe | `sun/SunLayers.js`, `sun/sun-shaders.js`, `sun/limits.js` |
| The solar wind's streamlines | `sun/SolarWind.js` |
| The regions' spots and the flares' kernels on the disc | `star-shaders.js` (region mode), `Star.js` |

## Activity by date

`sunspotNumber(ms)` is the monthly sunspot number, linear between months'
middles, from three sources in turn:

| Dates | Source |
|---|---|
| January 1997 to the last observed month (September 2026 in the file) | **NOAA SWPC's own monthly count**, `observed_swpc_ssn` of its [observed solar-cycle indices](https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json) |
| The month after, to December 2030 | **SWPC's forecast**, `predicted_ssn` of its [predicted solar cycle](https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json) |
| Before 1997, and after the forecast (blended into over 12 months) | **The cycle model** (below) |

SWPC's products are US Government work, not subject to copyright in the
US (17 U.S.C. 105; SWPC's terms page isn't reachable from the sandbox to
quote).  `sunspots.json` keeps the source URLs, the fetch date and the
recipe (`node tools/sun/sunspots.mjs > js/scene/sun/sunspots.json`);
tests never fetch.  **SILSO's international sunspot number isn't
bundled**: its licence (CC BY-NC 4.0) forbids commercial use.  SWPC's
observed product also carries it, as its `ssn` column back to 1749 (the
same values as SILSO's file), and that column is left out for the same
reason, which is why the observed record starts in 1997 (SWPC's own
count) and the model covers the dates before.  `setObservedSeries({start:
'YYYY-MM', ssn: [...]})` is the hook for another record, the
international number where its licence allows: months it covers are
observed, the rest fall back as above.  SWPC's count runs a few percent
over SILSO's at a maximum (124.9 against 116.4 smoothed in April 2014).

`smoothedSunspotNumber` is the 13-month running mean, and
`activityLevel` that over cycle 23's maximum (189 on SWPC's scale): 0 at
a deep minimum, 1 at a strong maximum.  The corona's shape, the CME rate
and the prominences follow the level; the regions and flares follow the
monthly number.

### The cycle model

Each cycle is Hathaway, Wilson & Reichmann's (1994) shape, F(t) = A x³ /
(exp(x²) − c), x = (t − t0)/b, with Hathaway's (2015) average c = 0.8 and
t0 four months before the minimum, normalised to the cycle's smoothed
maximum and with b from its rise.  The cycles it knows:

| Cycle | Minimum | Maximum | Peak | From |
|---|---|---|---|---|
| 21 | 1976-03 | 1979-12 | 232.9 | SIDC's smoothed series as tabulated (Australian BoM SWS; *Solar cycle 21*) |
| 22 | 1986-09 | 1989-11 | 212.5 | BoM SWS's table (Wilson 1993 dates the maximum July 1989) |
| 23 | 1996-05 | 2002-03 | 189.0 | NOAA/ISES panel (1997) for the minimum; SWPC's smoothed series |
| 24 | 2008-11 | 2014-04 | 124.9 | SWPC's smoothed series |
| 25 | 2019-12 | 2024-10 | 153.6 | SWPC's smoothed series |

Other cycles are the mean one: 11.0 years minimum to minimum (Hathaway
2015), the known cycles' mean rise (4.6 years) and peak (182.6), which
gives b = 56 months, Hathaway's average.  Before 1976 this is a model,
not the historical cycles (cycle 19's 1958 peak, the largest, isn't
there).  The model's minima are 18-30, higher than the observed ones
(2-6): the shape's slow decline overlaps the next cycle's rise.  Past
the forecast the model's cycle 26 starts in December 2030.

Each cycle's own share of the number at a date (`cyclesAt`) carries its
**spot zone**: Spörer's law as Hathaway (2011) standardised it, the
centroid at 28° exp(−t/90 months) from the cycle's fitted start, the
same for every cycle; a Gaussian of σ 4° to 8° with the cycle's strength
(narrow at the start, widest near maximum: Hathaway 2015's description,
modelled).  Near a minimum two cycles run: the old one's spots at 5-7°,
the new one's at 25-28°.

## Spots: the active regions

The Sun's spots are no longer the lattice's (which every other star keeps,
Stars.md): `activeRegionsAt(ms)` lists the sunspot groups alive then.

- **Emergence**: a Poisson process a day, its rate from the day's number
  (`emergenceRate`), each group born at a random time of the day, in a
  cycle picked by its share, at a latitude drawn from that cycle's zone,
  either hemisphere, at a random Carrington longitude.  The day's
  generator is seeded by the day and the star's seed (`sunRandom.js`), so
  any date's regions are the same, with no history to replay; a day's
  births are cached.
- **Size**: the group's largest area log-normal (the form Baumann &
  Solanki 2005 found), median 50 MSH, σ 1.4 in its log.  Those two are
  set so that a steady number R holds **R/20.1 groups** on the visible
  disc (the group number's 12.08 per group, Hoyt & Schatten 1998, on the
  version-2 scale, R_v2 = R_v1/0.6, Clette et al. 2014) and **10.0 R MSH of
  spots** (Hathaway 2015's 16.7 MSH per unit of the old number, from the
  RGO areas): within 2% of both (`activeRegions.test.js`), and over a year
  of 2001, 0.75-1.25 and 0.6-1.4 of them (the area's heavy tail).
- **Life**: growth over a tenth of the life (at least half a day), then
  parabolic decay, A0 (1 − t/T)², T = A0 / (10 MSH a day) (the
  Gnevyshev-Waldmeier rule; Petrovay & van Driel-Gesztelyi 1997, who also
  found the decay parabolic), at most 120 days.
- **Rotation**: each region drifts in the Carrington frame at its
  latitude's rate less Carrington's 14.1844°/day, the rate Ω = 14.713 −
  2.396 sin²φ − 1.787 sin⁴φ °/day sidereal (Snodgrass & Ulrich 1990): a
  region at 10° moves east half a degree a day, one at 30° west a fifth.
  The photosphere's mesh turns in the Carrington frame (the IAU's α0
  286.13°, δ0 63.87°, W = 84.176° + 14.1844° d: `sunFrame.js`), so its
  granules and the regions turn with the Sun, 7.25° from the ecliptic's
  pole (Stars.md's follow-up).
- **Shape**: a leading and a following spot astride the region's centre,
  the leader ahead in the rotation and nearer the equator, tilted 32.1°
  sin(lat) from the east-west line (Joy's law, Stenflo & Kosovichev 2012),
  apart by 3° + 4° √(A/500 MSH) (at most 15°: a model); the leader 60% of
  the area (a model), each a cap of 2πA·10⁻⁶ sr.  The shader draws each
  as the photosphere's spots were (umbra inside 0.42 of the radius at
  ΔT, penumbra at ¼ΔT, Berdyugina 2005), the leader's edge ragged 12%,
  the follower's 30%, with plage out to 0.6 of the separation plus six
  spot radii.  At most 24 regions, the largest on the camera's side.
  Spots fade under ~1.5 px of radius (the photosphere's band-limiting;
  its other features fade under 2.5-6 px), so a full disc shows its
  groups as dots.

At a deep minimum (December 2019) the disc is bare; on 2024-04-08 eight
groups, two on the Earth side.  These are the model's groups at the
observed number, not the day's real ones (AR 13628 and its neighbours).

## Flares

`flaresAt(ms, regions)` lists the flares under way.

- **Rate**: cycle 23 (May 1996 to December 2008) had 1,442 M and 126 X
  flares on GOES's scale before the 0.7 factor came out in 2020 (*Space
  Weather Space Clim.* 2025, swsc240043, Table 1), so flares of M1 and
  over come at those 1,568 over the cycle's integral of the number:
  0.0041 a day per unit of R: at R = 150 0.6 a day, four a week.  Their
  peak fluxes follow N(>F) ∝ F⁻¹ (a differential index of 2.0, as the
  catalogues' fits give, 1.9-2.1; cycle 23's M:X ratio of 11 says the
  same), drawn from C1 up, ten times as many: 6 a day at R = 150.  The
  model gives cycle 23 1,411 M and 157 X flares (1,442 and 126 observed)
  and cycle 24 819 of M1 and over (782 observed) (`solarEvents.test.js`).
  An hour's flares come from that hour's seeded generator.
- **Where**: in an active region picked by area; two kernels (ribbons)
  10-30 Mm apart across it, each 1.5 Mm in radius (white-light kernels
  are 1-3 Mm, 10¹⁶-10¹⁸ cm²).
- **When**: GOES rise and decay of minutes and tens of minutes (Veronig
  et al. 2002): 6 and 15 minutes at M1, as (F/F_M1)^0.15, ±50% (a model
  of the weak trend).  The white light is a bump over the impulsive
  phase, the rise.
- **White light**: about half of M and X flares show it, a tenth of C
  flares (Watanabe et al. 2017; Castellanos Durán & Kleint 2020).  The
  continuum's enhancement at 360 nm averages 19%, mostly under 30%, in
  those that do (the statistics summarised in arXiv:2512.01717).  The
  kernel is taken as a 10,000 K blackbody (the colour temperature fitted
  to flare continua; Kerr & Fletcher 2014) filling the share of the pixel
  that gives 19% at 360 nm; in luminance that is **7.2%**, for an M5 (the
  white-light flares' typical class), as (F/F_M5)^0.3: 2% for a C1, 9%
  for an X1, 18% for an X10 (a model of the bigger flares' brighter
  kernels; `emission.js` `flareContrast`).  So **most flares are invisible
  in white light**, and an X flare's kernels are a faint bluish brightening
  of a few granules, at the disc's own exposure.

## Prominences and filaments

`prominencesAt(ms)` lists them: the same structures, prominences over the
limb, filaments on the disc.

- **Population** (a model): 10 + 0.25 × the smoothed number on the whole
  Sun, born at random, living a median 25 days (log-normal, σ 0.7);
  35% active-region filaments (in the spot zone, 5-30 Mm high, ~5 days),
  then quiescent ones 5-30° poleward of the zone, and polar-crown ones at
  50-65°, more of them as the cycle rises.  Quiescent ones are 60-600 Mm
  long, 15-100 Mm high and 4-15 Mm thick (Mackay et al. 2010).  Each lies
  east-west, tilted ±40° (polar crown ±10°), carried by the differential
  rotation, and grows in and fades out over a tenth of its life.
- **Light**: Balmer emission.  Quiescent prominences' integrated Hα is
  10⁵-10⁶ erg cm⁻² s⁻¹ sr⁻¹ (Labrosse et al. 2010), over the disc centre's
  continuum at Hα, 4.077e-5 erg cm⁻² s⁻¹ sr⁻¹ Hz⁻¹ (Schmieder et al.
  2010's calibration: a 6,143 K blackbody there), an equivalent width of
  0.035-0.35 Å: 0.1 Å here (log-normal, σ 0.6), with Hβ at a Balmer
  decrement of 3 (Labrosse et al. 2010, after Gouttebroze, Heinzel & Vial
  1993).  Through the CIE observer that is **1.4e-5 of the disc's mean
  luminance**, pink (linear sRGB 0.0041 : 0.0006 : 0.0019 per nm of Hα):
  a few times the inner corona, which is why prominences are the pink
  points round the Moon in totality.  The emission grows with the path
  through the sheet, saturating past 30 Mm (Hα is optically thick in a
  prominence: a model).
- **Shape**: a sheet over the filament's line on the surface, a rounded
  hedge of its height with a noisy top, threaded vertically (1.5 Mm
  threads, faded where they're under a few pixels); four samples along
  the ray's path through the sheet.
- **On the disc**: a filament's Hα absorption, a few tenths of a line ~1 Å
  wide, is ~1e-4 of the visual band: invisible in white light, so not
  drawn.  An Hα view (the disc, filaments, plage and flares in the line)
  would show them: a follow-up.

## The chromosphere

At the limb, Balmer emission falling off over ~1 Mm, with spicules to
~10 Mm (Zirin 1988's heights): Hα of 0.05 nm (0.5 Å, the optically thick
base: a model of the flash spectrum's brightest line) with a 1 Mm scale
height, and 0.006 nm with a 3 Mm one.  A few megametres is under a pixel
from afar, so each pixel takes the profile's mean over its radial
footprint.  It shows as a pink rim in a coronagraph's view and at the
contacts of an eclipse; in totality the 2024 Moon (1.057 of the Sun's
radius from Dallas) covers it.

## The corona

The K-corona is computed, not fitted: the electron density, through
Thomson scattering of the disc's light, integrated along each line of
sight (`corona.js`):

  B/B☉ = (3σ_T R☉ / 16ρ) ∫ n(ρ sec θ) D(r) (1 + sin²θ) dθ,

ρ the line's closest approach in solar radii, θ the angle along it, D(r) =
2r²(1 − √(1 − 1/r²)) the finite disc's dilution (1 far off, 2 at the limb;
van de Hulst's limb darkening and polarisation left out).  24 samples
uniform in θ, from the camera's own θ (it may be inside the corona) to
the shell's far side, within 1% of a fine integral.

- **Density**: Saito's (1970) solar-minimum model from eclipse photometry,
  n = 3.09e8 r⁻¹⁶ (1 − 0.5 sin φ) + 1.58e8 r⁻⁶ (1 − 0.95 sin φ) + 2.51e6
  r⁻²·⁵ (1 − √sin φ) cm⁻³: its equator through the integral is
  **Baumbach's K-corona** (1937; 10⁻⁶ of the disc centre × (1.425 ρ⁻⁷ +
  2.565 ρ⁻¹⁷)) **within 13% from 1.05 to 2 radii** (a check of the
  physics, not a fit): 2.7e-6 of the disc's mean at 1.05 radii, 1.5e-6 at
  1.1, 6.4e-7 at 1.2, 1.1e-7 at 1.5, 1.6e-8 at 2, 1.6e-9 at 3.  Its poles, the coronal holes, are 4
  times thinner at 1.1 radii.
- **Shape by the cycle**: φ is the latitude from the **current sheet**,
  the magnetic equator the streamers lie along: a dipole's equator tilted
  from the rotational one by 10° at minimum to 75° at maximum, warped by
  low-order terms growing with the cycle (the Wilcox Solar Observatory's
  computed tilts, Hoeksema 1995, as a model: the series isn't reachable
  from the sandbox), its tilt's longitude drifting a turn a cycle.
  Streamers gather the density toward the sheet, ×(0.6 + 0.4
  e^−(φ/w)²), w from 35° at the surface (the helmets) to 8° past ~2.5
  radii (the stalks); rays and polar plumes are ±45% noise on the
  direction, so they run radially.  **Ludendorff's flattening** of the
  isophote through the equator's brightness at 2 radii, averaged over a
  rotation: **0.38 at minimum, 0.08 at mid-level, −0.11 at maximum**
  (observed: up to ~0.3-0.4 at minimum, ~0 at maximum, anti-correlated
  with the number; Pishkalo 2011 and the eclipse measurements since).
  At maximum a little polar elongation: the 75° tilt puts streamers at
  the poles.
- **F-corona**: the zodiacal cloud's, drawn by the night sky
  (`nightSky.js`; HDR.md), held inside 2 radii; not drawn twice.
- **Colour**: the disc's: Thomson scattering is grey.

### CMEs

`cmesAt(ms)` lists the CMEs in flight out to 40 radii (past LASCO C3's
30).  Their rate is 0.5 a day at minimum to ~6 at maximum (Yashiro et
al. 2004), linear in the level; their mean apparent width 47° at minimum
to 61° at maximum (the same), log-normal; their speed 300 to 550 km/s
with the level (Yashiro et al. 2003, for the narrow ones), log-normal;
their mass 10¹⁵ g typical, log-normal σ 1 (10¹³-10¹⁶: Vourlidas et al.
2010).  70% leave from the spot zones, the rest from the streamer belt (a
model's split), radially, fixed in space at launch, the front at the
launch speed (no acceleration: a model).  Their electrons (the mass over
1.17 proton masses an electron) are a shell at the front, Gaussian with σ
8% of its radius, through the cone with a soft edge, and a core of a
third the shell's at 0.55 of the front (the erupted filament), lumpy; they
go through the same Thomson integral as the corona, so their brightness
is physical: a 10¹⁵ g CME 50° wide at 5 radii is 1.9 times the
equatorial corona's density there in its shell, a faint loop, as in
LASCO's running differences.

## Eclipses

`eclipse.js` `visibleFraction`: the share of the disc's limb-darkened
light the camera sees past every planet and moon in front (64 rings, each
ring's coverage exact).  It scales:

- **the glare** (below), and the meter's luminous disc
  (`ThreeUI._luminousDiscs`: the visible part's equivalent disc; none
  under 1e-3), so in totality the meter exposes for the corona and the
  dark sky, not the hidden disc;
- **the sky**: the atmosphere pass's sunlight (`uSunIntensity`) by what
  the camera, in the air, sees of the Sun past bodies other than the air's
  own, plus what is scattered in from the sunlit air outside the shadow,
  `TOTALITY_SKY` = 6e-5 of the day's.  Measured: the zenith over Dallas in
  totality is **13.1 mag/arcsec²** (0.62 cd/m²), against Birriel et al.'s
  (JAAVSO 2026) 12.99-13.27 measured in totality (Oxford, Ohio;
  Wickliffe, Kentucky), and four orders of magnitude under the model's
  day zenith there (1.0e4 cd/m², 2.6 mag/arcsec²), as Shaw et al.'s
  simulations find (Applied Optics 2026).  Uniform over the sky: the
  sunset glow all round the horizon is a follow-up (the shadow sampled
  along the pass's rays);
- **the Sun's point** (the catalogue's origin; `uSunVisible`,
  `stars.vert`): dimmed with it, gone once the disc's centre is covered.
  From the ground the stars' depth pull puts them in front of the Moon,
  so depth couldn't hide it.

**The 2024-04-08 eclipse from Dallas** (32.78° N, 96.80° W): totality in
the app from 18:41:56 to 18:44:46 UTC (2 min 50 s, mid-eclipse 18:43:21,
the centres 0.49′ apart), against NASA's 18:40:43-18:44:35 (1:40:43-1:44:35
pm CDT, 3 min 52 s): the model's umbra passes some 40-50 km off Dallas's
place in it.  celestiary's Earth is a sphere and the link's latitude is
taken as geocentric (0.18° from the geodetic here, 20 km across the
path); the rest is the Moon's and Earth's models (not chased here).  The
Moon's disc is 1.060 of the Sun's (16.88′ and 15.93′).  The acceptance link (paused at mid-totality, labels
and orbits off):

`#sun/earth@32.78,-96.8009,200m;t=8864.2801jd;cq=0,-0.5777,0,0.8162;fov=3deg;s=F;time:pause`

and a minute and a half before totality, to watch it come:
`...;t=8864.27995jd;...` without `time:pause`.

Two fixes the eclipse needed outside the Sun's code:

- **The night sky over distant bodies** (`Atmosphere.js` `nightSkyDepth`):
  from the ground (near plane 100 m) a body's depth is 1 − n/d, past the
  galaxy's pinned 0.99995 for anything beyond ~4,000 km, so the night
  sky's light was added over the Moon and every planet; in totality the
  zodiacal light's core lay across the Moon's dark disc.  A body is now
  any depth under the larger of the pin and a body's at 10¹³ m.
- **The corona's shell at the far plane**: drawn one step of the 24-bit
  depth buffer inside it (at the Sun's distance its back faces are on the
  far plane's boundary, and some triangles were clipped), and each pixel's
  ray from its window position: the shell's vertices are 2e11 m away and
  their interpolated view positions put whole triangles' rays off by more
  than a solar radius on SwiftShader, wedges of corona taken for the disc.
  The inverse projection is taken at the near plane (at the far plane w
  is 1/far, nothing in float32).

## Glare

`glare.js`: the eye's veiling glare, the CIE's general disability glare
equation (CIE 135/1999, Vos & van den Berg), L_veil/E = 10/θ³ + (5/θ² +
0.1p/θ)(1 + (A/62.5)⁴) + 0.0025p per steradian, θ in degrees (0.1° to
100°), for a young observer (A = 25, p = 0.5).  It is light at the eye,
so it is drawn over everything (no depth test, a full-screen pass in the
scene, metered), as Spencer et al. (1995) argue: a display can't make the
eye scatter the Sun's light, so the image carries it.  For the Sun, 1° off
the veil is 1e-3 of the disc and 10° off 5e-6: the corona there, 1e-8,
can't show next to the bare disc, and the exposure that shows the disc
stops it down further.  A resolved disc's veil is the function's sum over
19 equal-area parts of it (exact far off, within a factor of a few near
the limb); over the disc itself none.  It scales with the visible
fraction, so it goes in totality.

It **replaces the limb glow shell** (`newAtmosphere` at 1.07 radii), a
ring of the disc's own radiance that no eye or camera sees, which would
have shown round the Moon in totality, and is the one visible change away
from the Sun's own layers: looking near the Sun the field is dazzled, from
Earth's surface by day and from space at a wide field (from Earth's orbit
at 45° the Sun, 11 px across, sits in a white veil ~10° wide at the
keyed exposure).  Every star drawn as a disc gets it.

## The solar wind

A diagram, not light: the wind's own brightness at 1 AU is ~1e-15 of the
disc's, far under the zodiacal light.  `SolarWind.js` draws Parker
spirals (Parker 1958), φ = φ0 − Ω(r − R☉)/v, 47° from radial at 1 AU for
the slow wind: 8 streamlines at each of 0° and ±45°, slow (400 km/s)
near the sheet and fast (750 km/s) above ±25° at minimum, as Ulysses found
(McComas et al. 2000), the fast wind's latitude rising with the cycle (a
model); out to 90 AU (the termination shock).  Dashes stream outward at
the wind's speed on simulated time, spaced at a tenth of the camera's
distance, shown round the camera's distance (inside a twentieth of it
the orbits are the diagram), in the overlay with the `o` toggle (orbits).

## A coronagraph

`c.ui.sceneManager.objects.sun.sunLayers.setOcculter(r)` puts an occulting
disc of r solar radii over the Sun (LASCO C2's 2.2, C3's 3.7): the disc
and what's inside the occulter hidden, no glare, no luminous disc for the
meter.  A probe for the corona and the CMEs, as the evidence below uses
it; `setOcculter(0)` takes it away.  `sunLayers.enabled` switches the
glare, corona, flares, CMEs and prominences one at a time, and the perf
overlay's `sun` toggle (`?perf=1&off=sun`) hides all the layers.

## Cost

- **CPU**: 0.1 ms a frame for the layers' update (events recomputed when
  the date moves 30 s; a day's regions and prominences cached; flares
  every frame).
- **GPU**: the corona's shell only where it can show: off when its
  brightest is under 1e-4 in exposure units at the frame's gain (the bare
  disc stopped down, any view the meter exposes for a sunlit surface), and
  only out to the radius it reaches over that (`uMaxRho`); 24 samples
  there.  The glare is a full-screen pass only while its reach gets into
  the frame.  Both are in the star's surface LOD level: past 1,000 solar
  radii (4.65 AU) nothing is drawn but the point.  Measured on
  SwiftShader (a CPU's emulation, for relative cost only): 640×480 from 3
  radii with the corona and glare covering the frame, 26 ms a frame
  against 19 with the layers off; from the ground by day and in totality
  the frame's ~0.5 s is the atmosphere pass's, the difference lost in
  its noise.  A real GPU's numbers want a `?perf=1&off=sun` snapshot.

## Evidence (this PR's)

Rendered on SwiftShader, labels and orbits off: the eclipse at totality
from Dallas (fov 3°, 1.2°, 0.6°; and cold from the acceptance link), at
second contact (the diamond ring's glare; then the chromosphere's pink
arc), the bare Sun from Dallas the same day (with and without the corona:
no pixel differs; with and without the glare), the disc at minimum
(2019-12-15, spotless), maximum (2014-02-20) and on 2024-04-08, an X5.9
white-light flare's kernels (2024-05-05 00:50 UTC in the model) against
the same view without it, a CME as a coronagraph's running difference
(2024-05-18 01:00 UTC, occulter 2.2 radii), the limb's chromosphere and
prominences with the disc occulted, and the solar wind from 10 AU.

## What's a model, what's data

| | Data | Model |
|---|---|---|
| Sunspot number | SWPC observed (1997-), forecast (to 2030) | HWR shape before 1997 and after 2030 |
| Cycle dates and peaks | 21-25 (BoM SWS, NOAA/ISES, SWPC) | the mean cycle elsewhere |
| Spot zones, rotation, decay, tilt | Hathaway 2011, Snodgrass & Ulrich 1990, Petrovay & van Driel-Gesztelyi 1997, Stenflo & Kosovichev 2012 | zone widths, leader's share, separation |
| Spot numbers and areas | calibrated to Hoyt & Schatten's group number and Hathaway's areas | the individual groups |
| Flares | rate (cycle 23's counts), index 2.0, white-light shares and 19% at 360 nm | durations' trend, contrast's trend with class, kernel size |
| CMEs | rate, width, speed, mass ranges | source split, constant speed, shell shape |
| Prominences | sizes (Mackay et al.), Hα intensity (Labrosse et al.), Balmer decrement | numbers and lifetimes, saturation, shape |
| Chromosphere | heights (Zirin) | its Hα |
| Corona | Saito's density, Baumbach's check, Thomson scattering, Ludendorff's index | the sheet's tilt and warp by level, streamer gathering, rays |
| Eclipse sky | 13.0-13.3 mag/arcsec² measured, ~1e-4 simulated | uniform over the sky |
| Glare | CIE 135/1999 | the extended disc's quadrature |

## Follow-ups

- The observed series before 1997: the international sunspot number
  through `setObservedSeries` where its licence allows (a commercial
  licence from SILSO, or a decision that the non-commercial terms fit),
  or another public-domain record.
- An Hα view: the disc in the line, with filaments, plage and flares.
- The eclipse sky's horizon glow (the shadow along the pass's rays), and
  the shadow on Earth from space.
- The Moon's limb profile (Baily's beads) from LOLA.
- Real CMEs and flares for past dates (from catalogues, if a host is
  reachable); the regions are statistical.
- WSO's measured current-sheet tilts for the corona's shape by date.
- The glare's near-limb integral done exactly, and its colour (the eye's
  scatter is a little red).
- Claret's limb darkening (Stars.md) also sets the corona's dilution.
