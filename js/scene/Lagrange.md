# Lagrange points, Hill spheres, synchronous orbits and orbital regimes

The space around a pair of bodies, a primary and the secondary that orbits
it: the Sun and a planet, a planet and a moon, Pluto and Charon; and the
regimes around a body that spacecraft use.  The first two parts of
[#272](https://github.com/celestiary/web/issues/272): its scope 1, the
analytic features every pair has, and its scope 2, Earth's orbital regimes
and their analogues ([below](#orbital-regimes)).  The three-body periodic
orbits and the rotating-frame view are its later parts.

- `js/scene/lagrange.js`: the math, no scene.
- `js/scene/LagrangeMarks.js`: a pair's marks, drawn.
- `Scene.lagrangePairsOf`, `_syncLagrange`, `pairFacts`, `spaceAround`: which
  pairs show, and their numbers.
- `Animation.layLagrange`: laying them on the pair each frame.
- `ControlPanel.spaceListHtml`: the info panel's *space around* list.

## What's drawn, and when

For the target, its pair with its primary and its pair with its most
massive moon (`lagrangePairsOf`). The Earth shows Sun–Earth and Earth–Moon,
the Moon Earth–Moon, the Sun Sun–Jupiter, Tethys Saturn–Tethys. A pair's
marks are made the first time it's wanted and taken out of the scene when
the target moves on. They're in the orbits group (`o`): they fade with the
orbit lines, and `s=o` in a link hides them.

- **The five points**: small rings, a fixed size on screen, named
  "Earth–Moon L1" and so on.
- **The secondary's Hill sphere**: its outline as the camera sees it
  (`overlayMarks.js` `faceOutline`: the circle where the lines of sight
  graze the sphere, R²/d nearer the eye than the centre and of radius
  R √(1 − R²/d²), so it stays on the true outline up close), named at its
  edge on the orbit's pole side.
- **The synchronous orbit**, where the body can hold one: a ring in its
  equator (under its `planetTilt`), named "geostationary orbit",
  "areostationary orbit" or "synchronous orbit"; the panel gives its radius.
  The radius, not the altitude: the descriptors' radii are mean radii, and
  an altitude over Earth's mean radius isn't GEO's familiar 35,786 km,
  which is over the equator.
- **Labels are short**: a label sprite is a square as wide as its text, with
  the text at its top, so it stands above its point by half its width (a
  40-character label, 160 px). Descriptions go in the panel.
- **Labels only where they can be told apart** (`LagrangeMarks._declutter`):
  an L1 or L2 label shows when its distance from the secondary spans 50 px
  on screen, L3 to L5 when the pair's separation does, the Hill sphere's
  and the synchronous orbit's when their radii do; the points show when the
  pair spans 12 px. From afar, Sun–Earth's L1 and L2 are named and
  Earth–Moon's L1 and L2 aren't, until you come in.
- **The info panel's *space around* list** gives the Hill radius, the pair's
  L1 and L2 distances (at the mean distance), and the synchronous orbit or
  why there's none.

## The model

The circular restricted three-body problem (CR3BP).  μ = m / (M + m), the
secondary's share of the pair's mass; the secondary's mass includes its
moons (the Earth with the Moon, Pluto with Charon), so the Sun–Earth pair is
the Sun and the Earth–Moon barycentre.

- **L1, L2, L3** are the roots of Szebehely's quintics in μ (*Theory of
  Orbits*, 1967, §4.5), by Newton's method from the Hill approximation
  ∛(μ/3) for L1 and L2 and 1 − 7μ/12 for L3.  L1 and L2 are measured from
  the secondary, L3 from the primary.  `lagrange.test.js` checks Szebehely's
  Earth–Moon values to 1e-6, and the force balance at all five points for μ
  from 1e-12 to 0.5.
- **L4 and L5** are the equilateral points, 60° ahead of the secondary and
  60° behind.
- **The pulsating frame.**  The points are placed along the secondary's place
  of the moment from the primary, scaled by its distance of the moment, and
  in its orbit's plane of the moment.  The pole comes from the body's
  elements now (`Animation.orbitElements`): osculating for the planets and
  the Moon, the mean elements for the moons.  So the points follow the
  real, eccentric, perturbed orbits the ephemerides draw (VSOP87C, the
  lunar theory).  For the Sun–Earth pair the line is the Earth–Moon
  barycentre's, and the Hill sphere is centred on the Earth.
- **The Hill radius** is a (1 − e) ∛(μ/3), at pericentre: the issue's form,
  a fixed size.  It differs from the L1 distance by under a few per cent.
- **The synchronous orbit** is ∛(GM P² / 4π²), with G·m from the
  descriptor's mass and P its sidereal rotation period.
  `synchronousOrbit` says when a body can't hold one:
  - `inside` the body;
  - `beyondHill`, past the Hill sphere, where the primary's tide takes it
    away: Mercury and Venus (slow rotators), the Moon (selenosynchronous at
    88,460 km, past its 57,900 km Hill sphere), and every tidally locked
    moon, whose synchronous orbit is ∛3 times its Hill radius.

  Mars's areostationary orbit, 20,428 km from the centre, lies between
  Phobos and Deimos, as it should.

## Checked against real co-orbitals

`js/scene/lagrange.horizons.json` holds JPL Horizons state vectors, from
`tools/lagrange/fetchHorizons.mjs`, which records its query.  They cover
each pair's secondary and the bodies at its points, relative to the
primary, at 1950, 2000, 2026 and 2050.  `lagrange.test.js` places the points
from the secondary's state and measures each body's longitude from its
point in the orbit plane:

| Body | Point | Worst over the four dates |
|---|---|---|
| Telesto | Saturn–Tethys L4 | 1.1° |
| Calypso | Saturn–Tethys L5 | 3.6° |
| Helene | Saturn–Dione L4 | 15° (it librates widely) |
| Polydeuces | Saturn–Dione L5 | 31° (its libration is ±30° and more) |
| Achilles, Hektor | Sun–Jupiter L4 | 18°, 19° |
| Patroclus, Aeneas | Sun–Jupiter L5 | 9°, 16° |
| 2010 TK7 | Sun–Earth L4 | ahead of the Earth at every date; its tadpole spans most of the orbit, so only the side is checked |

`Animation.lagrange.test.js` checks the laying: the pole is the real r × v
to under 0.01° (0.1° for a moon on mean elements), L4 is the side the body
is moving toward, and the Sun–Earth line is the barycentre's.

In the browser (headless Chromium, 2026 Oct 22), with the Earth as the
target:

- Sun–Earth L1 and L2 were 1,487,661 and 1,503,425 km from the Earth's
  centre.
- Earth–Moon L1 and L2 were 58,797 and 65,380 km from the Moon.
- L4 and L5 were on the Moon's orbit line, 60° either side.
- GEO was 42,164 km.

## Not yet

- **Search and `goTo`** for the points ("Earth-Moon L2") need targets that
  aren't bodies.
- **A setting of their own**: they're in `o` for now.
- **The rest of #272**: the three-body periodic orbits from JPL's
  catalogue, the rotating-frame view, the Moon's frozen orbits (scope 4).

## Orbital regimes

#272's scope 2: the regions spacecraft use around a body, Earth's first,
and their analogues where the physics carries over.

- `js/scene/regimes.js`: the table (`REGIMES`) and the math.
- `js/scene/RegimeMarks.js`: a body's regimes, drawn.
- `Scene._syncRegimes`, `regimesOf`: which body's show, and the panel's lines.
- `Animation.layRegimes`: turning the sun-synchronous orbits to the Sun.

They show for the target, in its equator (under its `planetTilt`), in the
orbits group (`o`), as the Lagrange points do. Altitudes are over the
equatorial radius (6,378,137 m for Earth), the reference GEO's 35,786 km
uses.

**Earth's:**

- **Shells**, drawn as a faint band between the shell's inner and outer
  outlines as the camera sees them (`faceOutline`'s geometry, both edges).
  A band isn't drawn from inside its shell.
  - LEO, 160 to 2,000 km up.
  - MEO, 2,000 km to GEO's 35,786 km.
- **Boundaries**, drawn as outlines:
  - **100,000 km up**, where the cislunar explainer behind #272 says the
    Moon's pull starts to matter. The video's auto-transcript names it
    something like "warden line"; searches found no source for that name,
    so it isn't used.
  - **Cislunar space**, out to the Earth–Moon L2, 1.168 of the Moon's
    distance. The 2022 US definition is the volume beyond GEO under the
    Earth's and the Moon's gravity, the Earth–Moon Lagrange points within
    it. The transcript's "torus" wasn't found in any source either, so the
    boundary is a sphere.
- **Orbits**, as ellipses in the equator's frame, Ry(Ω) Rx(i) Ry(ω) as the
  orbit diagram's:
  - **The GEO graveyard**, 300 km above GEO (with the GEO ring from the
    Lagrange marks beside it).
  - **GPS**: six planes at 55°, 26,560 km from the centre (20,200 km up),
    half a sidereal day.
  - **Molniya** (a 26,554 km, e 0.722) and **Tundra** (a 42,164 km,
    e 0.268): 63.4°, ω 270°, apogee over the north; periods of half a
    sidereal day and one. Their nodes are illustrative: in space they keep
    their ground tracks, which a fixed node in the inertial frame doesn't.
  - **Sun-synchronous, 700 km, dawn–dusk**: the inclination at which J2
    turns the node at the Sun's mean motion,
    cos i = −(2/3) n☉ a^(7/2) (1 − e²)² / (J2 R² √GM), 98.2° (Vallado's
    98.19°); its node is put at 6 pm local time each frame
    (`nodeForLocalTime`), so its plane follows the terminator.

**Mars's:** its areostationary orbit is the Lagrange marks' synchronous
orbit; its sun-synchronous orbit (J2 1.96045e-3) at 300 km and 3 pm, as
Mars Reconnaissance Orbiter's, is 92.7° (MRO's 92.65° at about 290 km).

**Checked:**

- `regimes.test.js`: the sun-synchronous inclinations (98.19° at 700 km,
  98.6° at 800 km, MRO's 92.65°), none past the height where J2 can't turn
  the node fast enough, the families' periods, Molniya's apogee, and the
  node's local time.
- `Scene.test.js`: which body's show and where, cislunar space at 1.168 of
  the Moon's distance, the GPS planes, a dawn–dusk orbit's pole within
  0.95 of the Sun's direction, and the panel's lines.
- `Animation.lagrange.test.js`: the Sun's direction in the equator.
- In the browser (headless Chromium, 2026 Oct 22 12:00 UTC), all 19 of
  Earth's programs and Mars's 2 compile, and the dawn–dusk orbit's pole was
  0.9987 along the Sun's direction (i = 98.19°).
