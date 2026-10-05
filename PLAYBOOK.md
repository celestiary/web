# Celestiary Collaboration Playbook

A living document — lessons Pablo and Claude have learned working together on this codebase.
Update it when we learn something new, positive or negative.

---

## Planning

### Write the plan before writing the code

Before touching any code on the Bruneton atmosphere work, we wrote `BRUNETON.md` first:
the math, the UV parameterisation, the two phases, the new files, the changes to existing files,
and the verification checklist. That document gave us shared vocabulary, kept the work
organised across multiple sessions, and survived context-window compression where conversation
history did not.

**Rule:** For any non-trivial feature or refactor, write a plan file first. Commit it. Code
against it. Update it when reality diverges.

### Phase the work

We split Bruneton into Phase 1 (transmittance LUT, kills j-loop grid) and Phase 2 (in-scatter
LUT, kills i-loop grid entirely). Each phase was independently testable. We kept the fallback
i-loop as a safety net while developing the LUT path — `uUseInScatterLUT` toggled between them.

**Rule:** When a large change can be phased, phase it. Merge Phase 1 when it works; don't block
on Phase 2.

---

## Debugging

### Trace every code path that touches modified state

The ghost-sphere fix had two follow-on bugs in a row:

1. Setting `uUseInScatterLUT = 0` in the no-atmosphere path correctly disabled the LUT, but the
   fallback i-loop then ran with stale `uPlanetCenter` — producing a solid sphere in the wrong
   position.
2. Fixing that by resetting `uPlanetCenter` but not moving `uUseInScatterLUT.value = 1.0`
   *outside* the `if (_lastAtmPlanet !== tObj)` block meant the flag stayed 0 when returning
   to a previously-visited planet — the re-enable never fired.

Each fix was locally correct but missed a code path. Before shipping a fix, trace **all** paths
that read the state you changed. Ask: "what else depends on this?"

### Separate rendering state from UI/navigation state

`targets.obj` is a navigation concept — it changes when the user presses 'u' to select a
parent object without moving the camera. Binding the atmosphere rendering directly to
`targets.obj` meant pressing 'u' immediately killed the atmosphere while the camera was still
inside it.

The fix: an `atmTarget` that falls back to `_lastAtmPlanet` when the selected target has no
atmosphere. Rendering should follow camera physics; UI selection is a separate concern.

**Rule:** When a rendering system breaks on navigation transitions, check whether it is
accidentally driven by selection state rather than camera/scene state.

### The problem is usually not what you think it is

Several times a "fix" attacked the wrong cause:

- **Mars rings:** Increasing `INSCATTER_STEPS` from 64 to 128 didn't help. The root cause was
  insufficient atlas rows near the horizon, not integration density. The fix (Bruneton
  horizon-aware μ_view parameterisation) was orthogonal to step count.
- **Dark side brightness:** `jOd = (1e4, 1e4)` seemed large, but kMie × 1e4 ≈ 0.21, so
  `exp(-0.21) ≈ 0.81` — still 81% transparent. Needed `(1e6, 1e6)` for optical depth > 20.
- **Depth-buffer gap pixels:** `depthSample > 0.999` as "background pixel" test failed when
  dynamicNear = 1 m compressed real surfaces at 10 km to depthSample ≈ 0.9999. Linearised
  `tMax` is robust to near-plane compression; raw depth samples are not.

**Rule:** Before writing a fix, write out the proposed mechanism and check it numerically.
A 2-minute back-of-envelope saves an iteration.

### State reset must be complete

When disabling a GPU effect, reset **all** uniforms that could cause visible output, not just
the toggle flag. `uUseInScatterLUT = 0` was correct but insufficient — `uPlanetCenter` still
placed the planet on-screen, and the fallback path rendered it. We reset `uPlanetCenter` to
`(0, 0, 1e20)` to push the sphere off-screen unconditionally.

**Rule:** When disabling an effect via a flag, also put every piece of geometry/parameter state
into a safe neutral value.

---

## GPU / shader specifics

### Parameterise by the quantity that changes smoothest

Linear UV mappings for look-up tables are only correct when the integrand varies linearly in
the parameter. Atmospheric scatter varies *steeply* near the local horizon because path length
through the dense low-altitude Mie layer changes as ~1/sin(elevation). The Bruneton
parameterisation maps μ_view by ray path length to atmosphere exit/ground — this concentrates
LUT rows near the horizon, giving ~8× better resolution there for Mars.

**Rule:** Before choosing a UV parameterisation for a LUT, plot (or estimate) how fast the
quantity varies across the range and concentrate samples where the derivative is largest.

### Encode and decode must be exact inverses

The Bruneton μ_view encode (lookup) and decode (precompute) must be mathematically inverse.
We derived both from the same geometric formula (`d = (rA² - r² - d²) / (2rd)`) and
verified at the boundary conditions (zenith, horizon, nadir) before coding. A mismatch
produces systematic banding that is hard to distinguish from an integration error.

### Bilinear filter bleeds across atlas tile boundaries

The in-scatter atlas packs 64 r-slices side-by-side. At μ_sun ≈ −1 (anti-solar point),
bilinear sampling bleeds into the adjacent tile's μ_sun ≈ +1 edge (bright dayside), producing
a spurious glow blob. Fix: clamp μ_s_t half a texel inward from each tile edge.

**Rule:** Any 2D texture that encodes a 3D or 4D table with tile packing needs half-texel
boundary clamps on the packed dimension.

### Trace a value's precision through every buffer it crosses

The HDR plan had Cesium's Moon shader write exposure-unit values above 1
into celestiary's new half-float buffer.  portal-netgl would have carried
them faithfully, but they never reached it: Cesium renders into its own
globe-depth framebuffer, `UNSIGNED_BYTE` unless its HDR is on, and copies
that to the screen.  Reading `Scene.js` and `GlobeDepth.js` found it before
any code was written; the fix was an encoding (PBR Neutral, inverted on
celestiary's side) rather than a change of units.

**Rule:** before relying on a range or precision end to end, list every
buffer the value passes through, including a library's internal ones, and
check each one's format.

### Inverting a tone map is exact for one draw, not for blends

Display-referred content (stars, labels) goes into the HDR buffer through
N⁻¹, so N gives it back.  For a single draw that's exact, but additive
overlaps of N⁻¹ values tone-map brighter than the old clamped sum (the toe
is square-root-like, so √a + √b > √(a + b)): overlapping star glows came
out ~13% brighter.  Measure blends separately from single draws.

### At light-years, clip-space w underflows the rasterizer's varyings

The human expansion lines (screen-space quads, js/scene/Colonization.md)
drew every triangle and showed nothing.  Clip-space w is the distance in
metres, ~1e18 a few hundred light-years out, and perspective-corrected
varyings are computed through 1/w products, which underflow float32 there:
a varying across the line's width came out pinned at its endpoint values.
Rendering the varyings as colours, and averaging them over the covered
pixels, found it in one run; the depth and colour probes before it didn't.
**Rule:** a shader drawing light-year geometry with varyings that must
interpolate (anything but flat colour) divides its clip coordinates
through to w = 1 once its vertices are known to be in front of the near
plane.  It's the same point and depth, and the varyings then interpolate
linearly on screen.

The same lines then flickered close up, from the same root: float32
across a light-year span.  A hop crossing the camera plane was cut at the
near plane (~6e5 m), but a point on a hop is resolved to ~1e-7 of its
length (~1e12 m), so the cut fell at or behind the camera depending on
the last bit.  A zoom sweep of pixel counts didn't show it; replaying the
shader's arithmetic in JS with `Math.fround` at the reported view did,
in one run.  **Rule:** when a shader computes a point between two
distant ones, size every threshold to the error of that computation (here
a cut at 1e-5 of the length), and set what must hold exactly (the cut's
depth) rather than computing it.  To debug a GPU number, replay it with
`Math.fround`, not pixels.

### GPU shader degenerate cases need explicit guards

The Bruneton decode has two degenerate cases: r = rG (ground, rho = 0) and r = rA (atmosphere
top, dMin = 0). Both produce 0/0. Guard with `max(denominator, 1e-3)` rather than
special-casing, since the output at those exact boundaries is either physically zero (no
atmosphere above top) or unobservable (camera exactly on ground).

**Correction (#141):** "unobservable" was wrong.  The lookup blends r-slices by altitude,
so the ground slice is most of what a camera below the next slice (1.3 km on Earth) sees.
The guard turned its ground rows into horizontal rays (mu = 0/1e-3 = 0), which integrated the
whole horizon: from 16 m the day ground was a bright yellow glow.  The fix special-cases them
to zero.  **Rule:** a guarded degenerate value is still a value; check what a blend or filter
makes of it, not only whether it's finite.

### A library's depth texture may not be the depth it drew

Cesium's terrain distance, for celestiary's atmosphere pass, came from a
post-process stage reading Cesium's depth texture.  The first cut put every
ridge at the encoding's limit (~310 km, where they were 3 to 25 km off), and
it still looked right, as the pass only asked whether a pixel had depth.
With `depthTestAgainstTerrain` off (the default) Cesium clears the globe's
depth after drawing it and draws its ellipsoid's instead: the texture held
the ellipsoid below the horizon and the far plane above it.  A test stage
writing log10(distance) into alpha showed it in one run.

**Rule:** before encoding a value, decode a probe of it into something you
can read (a column of numbers, not a picture), and check it against a
distance you know.  A fix that works for a boolean reason can hide a wrong
value.

### Sample a frame nearest when its alpha carries data

The decode pass read Cesium's frame through a bilinear texture.  At texel
centres that's exact in theory; on SwiftShader, a pixel just off a ridge's
silhouette read a sliver of its neighbour's alpha, which as a distance is
~0: a depth at the camera, no air, and a black fringe.  Premultiplied colour
blends that sliver harmlessly; a code in alpha doesn't.  **Rule:** a
texture whose channels are codes (distances, ids) gets `NearestFilter`,
and the decode treats less than half a level as nothing.

### A fix for one body: check every body that shares the path

The terrain-distance fix was Earth's (its globe, `albedo` output), and
Mars's Cesium layer, a tileset under the same atmosphere pass, kept the
bug: its terrain above the sphere's horizon was still drawn as sky.  And
Mars brought cases Earth hadn't: terrain mostly below the datum, a camera
below it.  **Rule:** when a fix keys on a property ("the albedo globe"),
list the other bodies that reach the same code, and look at each low and
at partial phase before calling it done.

### Don't cut a table's ray where the table can't see the cut

For terrain nearer than where the atmosphere tables' rays end, the pass
first took the table's values along the view ray and cut them at the
surface (S(eye) − T·S(P), then T from the table's depth times a marched
share).  The tables' rays end at the sphere or the atmosphere's top, sky
above the sphere's horizon and ground below, and they're coarse there: the
cut drew a seam across near ridges at that line, and was wrong for terrain
below the sphere and for a camera below it.  Each fix of a case found the
next.  Marching the segment itself, as the table integrates its rays, had
none of them.  **Rule:** when a precomputed table's parameterisation
doesn't contain the quantity you need (a ray ending at arbitrary terrain),
compute it directly rather than deriving it from the table's neighbours.

### A new depth test needs a check of what it now hides

To write the terrain's depth, the Cesium decode pass got a depth test
(`LessEqual`) as well as the write.  Every terrain check passed; but the
pass draws the globe after the scene, and where an orbit line or a point
behind Earth had written its depth, the decoded depth (from space, the far
plane) lost, and the line showed through the globe.  The stencil shell
already did that occlusion; the test only had to be on for the write.
**Rule:** when a pass that draws a body gains a depth test, look at the
body with lines and points behind it, not only at what the test was for.

### Don't let a shader decide a boundary it was handed a point on

The atmosphere pass clamped gap rays to the sphere's horizon, then the
table encode decided which side of the horizon the ray was on by
recomputing the horizon from `r` (`r² − rG²`, with most of its bits gone
a metre over a 3,000 km sphere in float32) and comparing.  The clamped ray
sat exactly on that boundary, so the side was rounding: SwiftShader's put
it in the sky rows (bright haze), the user's GPU in the ground slice's
zero rows (black), frame by frame ("flickering horizon").  Nudging the
clamp 0.006° to the ground side reproduced the black in the sandbox.  The
fix decides the side once, from the ray's geometry, and passes it in.
**Rule:** when code clamps a value to a boundary, no later stage may
re-derive that boundary and classify the value against it; carry the
side along.  And when a bug shows on the user's GPU and not in the
sandbox, look for a comparison at a boundary.

### Extend a table's domain by integrating outside it, not by moving the eye

The tables cover the shell from the ground sphere up.  For an eye below
the sphere (Cesium's terrain under a datum), #141 lifted the eye to the
sphere, which put its horizon within float32 noise of the rays clamped
to it (above), and would have moved the sky with the eye.  Treating the
table's lower bound like its upper one, marching the ray to where it
enters the domain and looking the table up there, needed no special case
and is continuous at the sphere (±5 m renders agree to 0.001).  **Rule:**
when a precomputed table's domain doesn't contain the ray's start,
integrate to the domain's boundary and hand over there, the same way at
every boundary.

### A quaternion from text isn't unit

The permalink writes the camera quaternion to four decimals, and the
restore set it as it was; three's `compose` doesn't normalize, so the
camera's world matrix carried a scale of 0.99999 and the atmosphere
pass saw the planet's centre 30-80 m too far: a camera 16 m under the
Dead Sea's datum read as 61 m over it, so the below-sphere path never
ran there.  Found by reading the pass's eye altitude back and comparing
it with the camera's.  **Rule:** normalize a quaternion that came from
serialized or rounded numbers before using it, and when two readings of
one quantity disagree by parts per million at planetary scale, suspect a
scale in a matrix chain.

---

## Testing

### Integration tests catch constructor order bugs that unit tests miss

The permalink restore feature had all unit tests passing (coords round-trips, encode/decode)
but the integration test revealed a silent init bug: `this._pendingPermalink = null` was
written in the constructor *after* `this.load()` was called, so `load()` set the permalink,
then the constructor immediately cleared it.  The feature silently did nothing on every page
load.

The bug was invisible to unit tests because each function was correct in isolation.  The
integration test (`js/Celestiary.test.js`) instantiates the real `Celestiary` with a permalink
hash and asserts that sim time, camera position, orientation, and FOV are all restored — end
to end, within a single test.

**Rule:** For async or multi-phase init code, write an integration test that drives the full
construction → async-settle → assert cycle.  Pure unit tests cannot catch sequencing bugs.

### Initialise fields before calling methods that use them

`this.load()` reads `this._pendingPermalink`.  The fix was to move the field initialisations
(`this.firstTime`, `this._pendingPermalink`, `this._permalinkTimer`) to *before* `this.load()`
in the constructor.  The constructor previously set those fields after calling `load()` as a
stylistic tidying step, which silently shadowed the value that `load()` had just written.

**Rule:** Any field that a method called from the constructor reads or writes must be
initialised before that method is called.  "Tidy field listing at the bottom" is not worth
the hazard.

### Clear timers a test leaves behind

bun runs every test file in one process, and `Shared.targets` is a module
global.  `Celestiary.test.js` left `_schedulePermalinkUpdate`'s 1 s timer
pending; it fired during whichever file ran next and read the plain-object
`targets.cur` a Scene test had set, as "unhandled error between tests".
Nothing failed on main, only because the files after it finished first.
Adding two slower test files (they load the 2 MB VSOP87 JS series) shifted
the timing and exposed it.

**Rule:** a suite that starts an app clears its timers in `afterAll`.  An
unhandled error attributed to an unrelated file is usually a timer from an
earlier one.

### A test's hand-built scene graph must match the app's

The Moon's orientation test built orbitPosition → planetTilt → node and
passed, while in the app the spun node sits two levels below planetTilt
(inside its planet LOD), so the tilt was applied twice.  Reading the chain
of `parent`s in the browser (`page.evaluate`) found it in one run.

**Rule:** before writing a test that mirrors the scene graph, print the
real ancestor chain from the running app and copy it.

### Test code belongs in test files, not one-off shell scripts

When debugging a codec, the instinct is to run a quick `bun -e "..."` snippet to verify
output.  Putting that verification in a proper test case is strictly better: it runs in CI,
is readable, and survives the session.

**Rule:** One-off `bun -e` / `node -e` invocations should become test cases instead.

### Check a published table against the reference at its own epoch

JPL's satellite mean-element table (#6) looked uniform, but wasn't:
- its period is the mean anomaly's for Jupiter's moons and the mean
  longitude's for Saturn's;
- it lists precession periods without signs, while Io's and Europa's
  apsides regress;
- Saturn's tabulated ω and M are 60–160° off JPL Horizons at the
  table's own epoch, while their planes agree;
- Triton's node period is half the one Neptune's IAU pole model implies.

Each showed up only by comparing with Horizons, first at the epoch, where
only the angles can be wrong, then decades out, where the rates show.
Separate the out-of-plane error from the along-track one: they have
different causes.

**Rule:** before trusting a table of elements or constants, compare it
with an independent reference at its own epoch, then away from it, and
record what was taken as is and what wasn't, next to the data.

### Time one call before choosing a sample count

The orbit lines were planned as "a few hundred VSOP87 samples per
planet".  One VSOP87C call evaluates all eight planets' full series and
takes ~2 ms, so that plan was seconds per rebuild.  Timing a call first
turned the design into a two-body ellipse plus 17 to 33 samples of the
departure from it, rebuilt a slice per frame.

**Rule:** before a design that calls an ephemeris (or any series) N times,
time one call in the browser and multiply.

### An osculating element isn't a mean one

The first sampled orbit lines used the osculating ellipse's period as
their window, and Neptune's line didn't close by 3% of its orbit: the
heliocentric velocity carries the Sun's own reflex motion (Jupiter's
pull), which puts the osculating period ~1% off the mean one.  The JSON's
periods, the fallback, were 0.07% short too: 365-day years.

**Rule:** an ellipse fitted at one instant carries the shape between
samples, but take periods and rates from mean elements.

### A staleness check that hides visuals flickers under load

The first orbit lines hid a line whose window had passed its body until
its rebuild finished, and restarted a rebuild whenever the date jumped
past its window.  Both were right at real-time rates.  At 30 days a
frame, Mercury's date left its window every two frames while a rebuild
took four: the line was hidden 199 frames of 200, and the restart meant
no rebuild ever finished.  The maintainer saw lines "pop in and out" at
high rates, and smaller steps made it vanish, which is the signature of
work that can't keep up with its input.  An orbit's shape changes over
millennia, so the stale line was a fine picture all along.

**Rule:** when derived visuals lag their input, keep drawing the last
good result and swap in the new one whole; don't hide on staleness.  And
any "restart on new input" needs a progress guarantee (here: restart at
most once), or fast input starves it.  Test it with a deterministic clock
paced by the real cost of the work, at the rates users will reach.

### Test in the units the eye sees

The orbit-line test allowed the body 1e-5 of the orbit's size off its
line, and passed; close up, Neptune's line ran near its limb and Pluto's
was 24 radii away.  1e-5 of 6e12 m is 60,000 km.  The error that mattered
was relative to the body (and the view), and it had two causes a
float64 test couldn't see alone: chord sag, and float32 on the GPU.  A
test that emulates the render (float32 vertices through a float32
model-view, camera at the body) and bounds the miss in body radii failed
on every planet and on Pluto at once.

**Rule:** state a visual tolerance in what's on screen (pixels, or the
size of the thing looked at), and compute the check the way the GPU does,
float32 included.

### Clamp a model's inputs to where it is valid, at the source

Pressing "faster" long enough took the date a million years out, where
VSOP87's powers of time put the planets 50,000 light-years away, on
orbit lines that agreed with them.  Nothing was NaN until the Date
formatter gave up at ±275,000 years, so no guard fired.  The fix clamps
the clock itself to the ephemerides' range, with finite-value guards
downstream as a second line of defence.

**Rule:** a series or polynomial model has a validity range; clamp the
input where it enters (the clock, the permalink parser), and show the
user when it's held.  Finite-value checks catch only the last symptom.

### Test across the full planet range, not just Earth

Earth's atmosphere (8 km Rayleigh scale height, mild Mie) is the most forgiving. Mars (3 km
Mie scale height, 2× Mie coefficient) has a steeper scatter gradient and exposed the horizon
parameterisation problem that Earth never showed. Venus and the gas giants stress different
limits.

**Rule:** After any atmosphere shader change, check at minimum Earth, Mars, and one no-atmosphere
body (Mercury, Pluto).

### Test navigation transitions, not just steady-state views

The ghost sphere only appeared *after* pressing 'u'. The solid-sphere regression appeared
when going Sun → Earth after previously visiting Earth. Static per-planet screenshots miss
entire classes of state-management bugs.

**Test matrix for atmosphere changes:**
- Orbit view, surface view, dark side, terminator, anti-solar point
- Navigate to planet → press 'u' → navigate back
- Visit planet A → visit no-atm body → return to planet A
- First visit vs. return visit (LUT recompute vs. cached)

### "Still there" is signal; treat it as data

When a fix doesn't work, "nope, still there" closes the loop immediately so we can pivot.
Don't assume a fix worked and move on to the next thing. Confirm each fix visually before
moving to the next bug.

### A shader edit that was only checked by arithmetic was never checked

PR #153's second follow-up rewrote the star kernel and declared `float half` in
`stars.frag`.  `half` is a reserved word in GLSL ES (with `fixed`, `double`,
`long`, `short`, `input`, `output`, `sizeof`, `namespace`, ...), so the fragment
shader failed to compile and the star Points drew nothing: "sun shape is
fixed, but not seeing any stars" on the preview.  The change had been
verified by working the sprite law through in JS, and its unit tests
passed; nobody rendered it.  A failed compile is silent in a test that
never creates a GL context: three logs it as a console error and marks the
program `runnable: false` (`renderer.properties.get(material).currentProgram.diagnostics`).

**Rule:** a shader change isn't done until a frame has been rendered with
it and the console checked for `THREE.WebGLProgram: Shader Error`, however
small the edit.  Keep the shader's law mirrored in JS (`exposure.js
starSprite`) so the arithmetic is tested, and scan the sources for GLSL
reserved words (`exposure.test.js`, "the shaders"), but neither replaces
the render.

**And SwiftShader is not the user's GPU.**  With the compile fixed the
user's M2 Mac (ANGLE on Metal) still showed no stars, with nothing in the
console: the metered exposure took a star field for an empty frame and
held its gain at 1.  Its rule was "every meter tap exactly zero", and a
star field at the keyed exposure is a few hundred 2 px points of 1e-5 to
1e-7, all under half-float's smallest normal value (6.1e-5): a GPU may
flush them to zero, and 1,024 taps over the frame can miss them anyway.
SwiftShader keeps half-float denormals, so it saw one star's edge at 4e-8
and carried on.  **Rule:** never decide "nothing drawn" from pixel values
near a buffer's floor; use what the scene knows (`frameCanBeEmpty`: the
catalogue loaded, the target's surface in).  Where a check depends on the
GPU, give the user a way to read the state on their machine
(`c.ui.starsDebug()`) rather than guessing from here.

### Screenshots communicate visual bugs better than words

"A grid of large blooms on the ocean texture" and "distinct rings floating up in space" were
clearer as screenshots than descriptions. For any visual rendering bug, a screenshot is worth
more than a paragraph.

---

## Collaboration

### Pablo has the domain context; trust his instincts

Pablo worked at Google when Eric Bruneton joined, and Google Earth used Bruneton's atmospheric
rendering. When he said "go full Bruneton" after jitter+64-step failed, that was the right
call. We could have gotten there sooner by trusting the domain knowledge earlier rather than
trying incremental step-count increases first.

**Rule:** When Pablo names a specific technique, algorithm, or person, treat it as a strong
signal, not a suggestion. Research it before proposing an alternative.

### "Not that big of a deal rn" means defer, not ignore

When Pablo said the Earth surface concentric rings were "not that big of a deal rn," we noted
it (in memory) and moved on. We didn't keep pushing on it or circle back to it uninvited.

**Rule:** Deprioritisations go in memory, not in the active work queue. Revisit only if
relevant to a later task.

### Tight feedback loops beat large batches

Our most productive sessions had a rhythm: one fix → Pablo tests → report → next fix. Batching
multiple changes made it harder to isolate which change caused which regression (the ghost-sphere
saga). Smaller, confirmed steps compound faster.

**Rule:** Don't stack more than one speculative change between test cycles. If a fix is
uncertain, get confirmation before building on top of it.

### Plan files survive context limits; conversation history does not

This project ran long enough to hit context-window compression twice. `BRUNETON.md` and the
memory files survived intact. Critical decisions and designs captured only in the conversation
were lost and had to be reconstructed from summaries.

**Rule:** Any decision, design choice, or known-but-deferred issue that will matter in a
future session must be written to a file or memory entry before the session ends.

### Memory entries are for non-obvious facts, not code state

The memory system is useful for: Pablo's background, feedback on approach ("don't mock the
database"), project decisions that aren't visible in the code. It is not useful for: which
lines were changed, what the current shader does, file structure — those are derivable by
reading the code. Write memories for *surprises* and *context*, not for facts that `grep`
can answer.

---

## Process

### Read before editing; verify before trusting summaries

Conversation summaries compress detail. File contents drift. Before making a targeted edit,
read the relevant section of the actual file even when a summary exists. Several edits in this
project required re-reading to find that the summary described an earlier version of the code.

### Comments explain *why*, not *what*

The transmittance LUT GLSL has this comment:

```glsl
// jOd stores density-weighted path lengths in metres; kMie ~ 2e-5 m⁻¹
// so we need jOd >> 1/kMie ~ 5e4 m to drive exp(-k*jOd) to zero.
// 1e6 m gives τ_Mie ≈ 21, τ_Rayleigh ≈ 33 → attn < 1e-9.
```

The number `1e6` is otherwise magic. The comment makes the *why* reviewable without re-deriving
the physics. This pattern was consistently more valuable than "set jOd to block sun" comments.

**Rule:** GPU shader constants that come from physical reasoning need a derivation comment
(even a one-liner). Future maintainers should not need to rederive them.

### Keep the fallback path until the new path is proven

We kept the i-loop fallback (`uUseInScatterLUT = 0`) for the entire development of the LUT
path. This meant we could toggle between them to isolate regressions and always had a working
render to compare against.

**Rule:** New rendering paths should be introduced behind a flag with the old path as fallback.
Remove the fallback only after the new path is confirmed correct across the full test matrix.
