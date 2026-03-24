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

### GPU shader degenerate cases need explicit guards

The Bruneton decode has two degenerate cases: r = rG (ground, rho = 0) and r = rA (atmosphere
top, dMin = 0). Both produce 0/0. Guard with `max(denominator, 1e-3)` rather than
special-casing, since the output at those exact boundaries is either physically zero (no
atmosphere above top) or unobservable (camera exactly on ground).

---

## Testing

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
