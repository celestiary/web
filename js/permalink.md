# Permalink Design

## Purpose

Permalinks encode a complete Celestiary view — celestial target, simulation time, camera
position, orientation, and field of view — in the URL hash. Any URL in the address bar is a
shareable, bookmarkable link that reproduces the exact view.

## URL Format

```
#<path>@<lat>,<lng>,<alt>;<params>
```

The path is the target: a body, a place on one, a star or an asterism (`sun/earth`,
`sun/earth/new-york`, `hip:32349`, `asterism:orion`; `js/targetPath.js`, and
[design/URLs.md](../design/URLs.md#path) for the grammar).  It changes whenever the target does,
a click on a label included, and the camera doesn't.

The `@` separates the path from the camera/time state.  The first component
after `@` is the geographic position prefix `lat,lng,alt` (Google Maps style).  The remaining
**params** are semicolon-delimited `key=value` pairs.  Order of params is not significant;
unknown keys are ignored (forward compatibility).

Hashes without `@` are legacy path-only URLs and continue to work unchanged.

After the view params come **state tokens**, `label:value` (the `:` before any `=`), for the
widgets drawer and its apps: `apps:open,view=expansion;apps.expansion:k=6,run=1`.  They're
returned as given in `decodePermalink(...).tokens`.  Spec: [design/URLs.md](../design/URLs.md).

### Example

```
#sun/earth@30.2638,-97.7526,3282m;t=9233.1234jd;cq=0,0,0,1;fov=45deg
```

### Position Prefix — `lat,lng,alt`

| Component | Encoding | Example | Meaning |
|-----------|----------|---------|---------|
| `lat` | trimmed float (4 dp) | `30.2638` | Latitude in degrees, −90…+90 |
| `lng` | trimmed float (4 dp) | `-97.7526` | Longitude in degrees, −180…+180 |
| `alt` | SI-prefixed meters | `3282m` | Altitude above surface |

### Parameter Reference

| Key | Type | Example | Meaning |
|-----|------|---------|---------|
| `from` | path | `sun/earth`, `hip:32349` | The camera's frame (below), when it isn't the path's body; written right after the position |
| `t` | Measure: days from J2000 | `9233.1234jd` | Simulation time, clamped on decode to ±2191500 days (J2000 ± 6000 years, Time.js's supported dates); a non-finite `t` makes the fragment invalid |
| `cq` | 4× dimensionless float | `0,0,0,1` | Camera quaternion (platform-local) |
| `fov` | Measure: degrees | `45deg` | Camera field of view |

## Coordinate System

### The camera's frame

The position and `cq` are in the frame of the body the camera is at (`Shared.targets.cur`, the
camera platform's parent): the path's body, or a place's body, unless `from=` names another.  When
the camera has gone to a star, it's that star (`from=hip:N`, or the path itself when the star is
the target): its centre, the scene's axes, and its radius.

Targeting leaves the frame alone, so it changes only the path and `from`, never the position or
`cq`.  Re-expressing the camera in the target's frame instead was ruled out: a far body's frame
loses the camera (4 decimal places of a degree are 2,300 km at Saturn from Earth), a star or an
asterism has none, a landed camera (`s=L`) belongs to the body it stands on, and a reload would
leave the camera riding the target's orbit rather than its own body's.

### Body-fixed geographic frame

Lat/lng are defined in the **body-fixed frame** of the frame body.  The planet's world
quaternion (including axial tilt and current sidereal rotation) maps body-local to world space:

- **Y-axis** = rotation axis (geographic north pole)
- `lat = asin(y / r)` — angle above equatorial plane
- `lng = atan2(x, z)` — longitude in equatorial plane

At a given `t` (simulation time), the orbital position and sidereal rotation are fully
determined, so lat/lng are unambiguous.  This applies equally to Mars, the Moon, and other
bodies, since VSOP87 (for major planets) and Keplerian elements (for moons) fully determine
positions at any epoch.

### Camera reference frame

`cq` is the camera quaternion expressed in **platform-local space**.  The camera platform is a
Three.js `Object3D` parented to the target's `orbitPosition`, with its −Z axis pointing toward
the solar system origin (`platform.lookAt(origin)`).  Restoring at the same `t` places the
platform in the same orientation, so `cq` reproduces the exact viewing direction.

## Measure Encoding

Values follow the `@pablo-mayrgundter/measure.js` convention: `scalar + unit_abbrev`, no spaces.
New units (`jd`, `deg`) are accumulated locally in `js/permalink.js` and will be upstreamed to
measure.js later.

### Time — `jd` (days from J2000.0)

`d2000 = JD − 2451545.0` where JD is the Julian Day number, on the simulation's UTC clock
(`Time.toJulianDay`: the Unix epoch is JD 2440587.5 exactly).

Links made before that constant was fixed (it was 2440587.500169, 14.6 s ahead) restore
the clock 14.6 s later than they showed.  The JD is the one they saved, so the bodies and the
view come back where they were.

VSOP87 planetary theory uses T = d2000 / 36525 (Julian centuries from J2000), so this is the
natural time axis for the simulator.  4 decimal places ≈ 8-second precision, more than adequate
for any shareable view.

Examples: `0jd` = noon 1 Jan 2000, `9233.1234jd` ≈ March 2025, `-36524.0jd` = 1 Jan 1900.

### Altitude — SI-prefixed meters

| Range (abs) | Suffix | Factor |
|------------|--------|--------|
| 0 | `0` | — |
| ≥ 10¹² | `Tm` | 10¹² |
| ≥ 10⁹ | `Gm` | 10⁹ |
| ≥ 10⁶ | `Mm` | 10⁶ |
| ≥ 10³ | `km` | 10³ |
| otherwise | `m` | 1 |

Altitude is rounded to the nearest metre before encoding.  Zero is the bare token `0`.

### Quaternion — short floats

Components formatted with `parseFloat(v.toFixed(4)).toString()`, trimming trailing zeros.
The identity quaternion encodes as `0,0,0,1`.  4 decimal places ≈ 0.01° orientation error,
imperceptible at any zoom level.

### FOV — `deg` (degrees)

`parseFloat(fov.toFixed(2)).toString()` + `deg`.  Trailing zeros trimmed, so `45.00` → `45deg`.

## Auto-update Behaviour

The URL is updated automatically via `history.replaceState` 1 second after the camera settles
or the target changes (`Scene.onTargetChange`), debounced.  `replaceState` does not fire a
`hashchange` event, so no reload occurs.

Updates are suppressed while a camera tween (`Shared.targets.tween !== null`) is in progress,
ensuring the permalink always represents a stable, settled view.  Updates are also suppressed
for objects without a defined radius (e.g. the galaxy root).

## Permalink Restore

On page load from a permalink URL, or a new one in the address bar (`Celestiary._navigate`):

1. The path is resolved: a body path's last segment is a body or a place (the body above it is
   loaded first to tell), and the target's body and the frame (`from`, else the target's) load.
2. Simulation time is set to the saved `t` before any navigation.
3. `Animation.animateAtJD(scene, jd)` positions all planets at that time without advancing the
   clock.
4. `Scene.goTo()` reparents the camera platform to the frame body's `orbitPosition` (or
   `Scene.land` to the body itself, for `s=L`; or `Scene.goTo(star)` for a star's frame).
5. `latLngAltToLocal(lat, lng, alt, radius, planetWorldQuat, platformWorldQuat)` converts the
   saved geographic position back to platform-local camera position.
6. The camera is snapped directly to that position (tween cancelled) — no fly-in animation.
7. The target is set (`Scene.setTarget`, without turning the camera) once what it needs has
   loaded: a place's catalogue, the stars, the asterisms.  One that isn't in its catalogue leaves
   the frame's body the target.

## Future Work

- **Track/follow state:** `track=1` or `follow=1` params for the 't'/'f' key modes (what 't'
  tracks, the target, is in the link now).  Better
  suited to an explicit "share" action than auto-update (state is transient).
- **E2E screenshot test:** Playwright + dev server opens a constructed permalink URL, waits for
  scene settle, takes a screenshot and compares to a stored reference.
- **Upstream `jd` and `deg`** to `@pablo-mayrgundter/measure.js`.
