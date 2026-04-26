# Atmosphere composition: what the post-process pass actually does

Bruneton's precompute (see `BRUNETON.md`) gives us per-frame access to two LUTs:
- `tTransmittance` — fraction of light surviving a column at `(r, μ_v)`
- `tInScatter` — light scattered into a ray at `(r, μ_v, μ_s)`

This doc covers what the fullscreen post-process does on top of those samples
to compose the final pixel — the artistic/perceptual rules that turn
physically-correct radiance into something that reads as sky from any
viewpoint, day or night, surface or orbit.

## Composition equation

Final pixel = inscatter (sky color) + scene background (stars, surface, etc.)
attenuated by transmittance:

```glsl
gl_FragColor.rgb = color + scene.rgb * (1.0 - alpha)
```

where `color = 1.0 - exp(-scattered)` (soft saturation of LUT inscatter), and
`alpha = 1 - transmittance` from the LUT. This is the standard
single-scattering equation: forward-scattered atmospheric light, plus
attenuated background.

## Why the raw equation isn't enough

Two real-world phenomena aren't captured by the LUTs alone:

1. **Eye adaptation under bright sky.** Real eyes' iris constricts under
   daylight, so faint background sources (stars, distant planets) become
   sub-threshold even though physics says ~14% of their light reaches the
   retina at zenith from sea level. Without compensating in the renderer,
   star labels and Hipparcos points clearly poke through the day blue.
2. **Sub-pixel rasterization gaps in the surface mesh.** Earth's world
   position is ~1.5e11 m; float32 precision in the model-view matrix
   degrades to ~1m, which produces sub-pixel holes at extreme close range.
   The depth buffer at those pixels reads "far" (sun, stars), and naive
   compositing leaks the background through where the surface should
   have covered.

## The five composition rules

Computed in this order in the LUT branch (lines ~640–700 of `Atmosphere.js`);
the ray-march fallback applies the same rules with corresponding variables.

1. **LUT alpha** — `alpha = 1 - exp(-tau_max_channel)`. Trust the
   precompute. At zenith from sea level this is ~0.14, giving ~86% star
   transmittance — physically correct.
2. **Cap at 0.92** — `alpha = min(alpha, 0.92)`. Floor of 8% transmittance
   for any background. Earlier revs forced the inside-atmosphere alpha
   to ~1; that hid stars at the night horizon along with everything else.
3. **Brightness-tied opacity** — `alpha = max(alpha, smoothstep(0.01, 0.1, sky_max_ch) * altWeight)`. Models eye adaptation. Two factors:
   - `smoothstep` snaps alpha to 1 once the sky is even faintly bright,
     so day blue overrides stars without needing physically-implausible
     extinction.
   - `altWeight = clamp(1 - camAlt/atmHeight, 0, 1)` weakens the boost
     with altitude. At the surface (full weight) the eye is deeply
     embedded in the column and adapts fully; at the top of the
     atmosphere (zero weight) the eye effectively becomes a camera, no
     iris dilation, just LUT extinction. Without this gate, looking
     down at the day side from space turned the disc into featureless
     blue and hid the surface texture.
4. **`insideAtm` gate** — the brightness boost is also conditional on
   the camera being inside the atmosphere shell. From space the LUT alone
   correctly captures the thin-column transmittance; boosting it would
   over-occlude.
5. **Gap-pixel hard occlusion** — if `isGap` (geometric ground in front
   of recorded depth), force `alpha = 1.0`. The sub-pixel holes show
   only inscatter (bright haze by day, dark by night) instead of leaking
   background. Side effect: a crisp horizon edge regardless of mesh
   tessellation density.

## Per-body sun intensity

`atmosphere.sunIntensity` in each body's JSON descriptor is a tuneable
knob that controls how bright the inscatter feels relative to the
renderer's `toneMappingExposure` (3e-16, calibrated for sun-lumens
scale). Earth's value is currently 60 — bumped from 20 so the day-side
inscatter cleanly saturates the smoothstep, hides labels through the
brightness-tied alpha, and feels like real daylight.

## Knobs you might want to tune

- `0.92` extinction cap — lower = stars peek through more at night
  horizon; higher = more opaque
- `(0.01, 0.1)` smoothstep bounds — lower bound = brightness at which
  stars start fading at dawn; upper bound = brightness at which sky
  goes fully opaque. Narrower band = sharper twilight star-fade.
- `altWeight` curve — currently linear `1 - camAlt/atmHeight`. Could
  be steepened (e.g. `pow(1 - alt/H, 2)`) so eye-adaptation drops off
  faster with altitude.
- Per-body `sunIntensity` — primary lever on overall day brightness.

## Known gaps / future work

- **Surface-vs-atmosphere coloring from space.** The additive composite
  of inscatter + surface*T reads OK but the saturation/hue balance over
  land vs ocean isn't perfectly tuned, and the coastal hand-off looks
  slightly washed. Plausible knobs: per-channel inscatter scaling, a
  soft saturation curve on the composite, or proper aerial-perspective
  integration over the segment from surface depth back to camera.
- **Auto-exposure (eye adaptation over time).** The `altWeight` boost
  is a static per-pixel proxy for eye adaptation. A real implementation
  would sample average scene luminance and adjust `toneMappingExposure`
  with a temporal smoothing filter (~2 s constant) — letting the same
  rendering work for stars-from-orbit and sun-disc-up-close without
  per-context tuning.
- **Multiple-scattering.** Current LUT is single-scatter only; the
  twilight glow on the antisolar horizon is a multi-scattering
  phenomenon that would need additional precompute passes.
