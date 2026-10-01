# Human expansion

A what-if: humans leave the Sun at a fraction of light speed and spread
star to star across the catalogue (~107k stars).  The Widgets button
(top right) opens a drawer with the parameters, a play/scrub timeline and
stats; the spread is drawn like the asterisms, one line per hop.

| File | Holds |
|---|---|
| `Colonization.js` | the graph and the spread: k-d tree, kNN graph, bridging, layered BFS, timeline helpers (pure, tested) |
| `ColonizationLines.js` | the lines: instanced screen-space quads, RTE, coloured and sized by hop, grown, pulsed, and the selected star's route |
| `../ui/ColonizationDrawer.jsx` | the drawer: show switch, model parameters, timeline, selected star's route, line and pulse controls, stats |
| `../store/ColonizationSlice.js` | `isColonizationVisible`, the `x` setting mirrored for the drawer |

## The model

- **Graph.** Each star links to its `k` nearest neighbours (default 6),
  symmetrised.  A fixed hop range doesn't work for this catalogue: it's
  magnitude-limited, so neighbours are ~4 to 9 ly apart near the Sun and
  tens to thousands of ly apart at its edge, and any one range either
  strands the outer stars or links everything near the Sun to everything.
  kNN adapts the hop length to the local density.
- **Bridging.** If the kNN graph is disconnected, every cluster but the
  largest links its closest star to the nearest star outside it, repeated
  (Borůvka) until one cluster is left.  At `k` = 6 the catalogue needs
  none; at `k` = 3 it needs 15.
- **Hops.** A layered BFS from the Sun: a star's hop is the fewest hops
  from the Sun.  Among parents in the previous layer, it takes the one
  whose ships arrive first.
- **Time.** Ships leave the Sun at year 0.  A colony waits the launch
  delay (default 100 years), then sends ships on: arrival = parent's
  arrival + delay + distance / speed (default 0.5c).

At the defaults: every star reached, 64 hops, ~47,000 years; hop length
median 36 ly, max ~5,500 ly.  Alpha Centauri A, B and Proxima, Barnard's
Star, Sirius and Gliese 411 are hop 1.  About 1 s to compute, on the main
thread, behind the drawer's "Computing…" state.

## Drawing

- **Wide lines.** WebGL draws `LINES` 1 px wide whatever `linewidth`
  says, so each hop is an instance of one quad (`InstancedBufferGeometry`,
  ~107k instances), extruded across its screen direction in the vertex
  shader, with square caps so consecutive hops meet, and a pixel of
  antialiased edge (a 1 px line is fully covered at its centre, like a GL
  line).
- **Colour.** One colour per hop, stepped evenly along the longest path:
  near white (hop 1) through blue to near black (the last hop).  Display
  values, through `sceneReferred` (HDR.md), so the tone map gives them back.
- **Growth.** Each segment's child end moves from its parent star at
  departure to its own star at arrival (`aTimes`), so ships in transit
  show as growing lines, and a segment is culled before departure.  The
  timeline is one uniform (`uTime`): scrubbing rebuilds nothing.
- **RTE.** As the asterisms: float32 high + low positions about the
  camera, turned by `mat3(modelViewMatrix)`, a child of `Stars` in the
  `StellarFrame`.  Light-year coordinates stay exact, and the lines
  precess and rebase with the stars.  Each segment is trimmed to the near
  plane in view space before projecting, as a hop passing behind the
  camera would otherwise project through infinity.
- **Visibility.** A scene annotation: the `x` setting (`x` key, in
  Settings under Labels, and the drawer's "Show lines" switch, kept in
  step through the store's `isColonizationVisible`) and so the global
  `V`.  Running a spread turns `x` back on.  The drawer is HTML chrome,
  so `v` hides it.

### Line controls

- **Width:** the first hop's and the last hop's, linear between
  (`hopWidth`; default 6 px to 1 px).
- **Opacity:** one alpha for every hop; blended over the stars.
- **Size attenuation:** off by default.  On, a line is its width at a
  reference distance from the camera ("Full width at", 10 to 10,000 ly)
  and scales inversely with distance, per end, so a hop running away
  from the camera tapers.  Never wider than 4x.  Under 1 px a line's
  coverage, so its brightness, falls with its width: far lines fade.

### Pulse

Off by default.  The pulse sits T seconds on each hop in turn, from hop
1 to the last, then loops: the hop it's on is whitened (85%) and drawn
twice as wide.  With a trail of N hops, the hops behind it step back to
normal over N steps (`pulseBoost`: 1, then N/(N+1) down to 1/(N+1)), and
the cycle runs N steps past the last hop so the trail clears before it
restarts (`pulseCycle`).  The clock is `performance.now()` in the
segments' `onBeforeRender`, so the pulse runs whether or not the
timeline plays.  It shows only on segments that exist at the timeline's
time.

### Selected star's route

When a star is committed (the search bar's crosshair picker, or a search
for it: `committedStar` in the store), the drawer follows its parents
back to the Sun (`pathTo`) and draws that route over everything: amber,
4 px, whole whatever the timeline's time, without depth test.  The
"Selected star" box gives its hops, arrival, the years in transit and
waiting at colonies (arrival = transit + one launch delay per colony on
the way), route length against the straight-line distance, and its hop
lengths (min, max, mean).

### Lessons (GPU)

- **Winding.** The quad's perpendicular is the screen direction turned
  left; with the index order backwards every quad was a back face and
  culled, which looked exactly like "nothing draws".
- **Huge w.** Clip-space w is the distance in metres, ~1e18 at a few
  hundred light-years.  The rasterizer's perspective-corrected varyings
  work in 1/w products that underflow float32 there: the side-of-line
  varying came out pinned at +-1 and the edge coverage 0, so the lines
  were drawn but invisible.  The shader divides clip coordinates through
  to w = 1 (same point and depth; safe as both ends are in front of the
  near plane), which also makes varyings interpolate linearly on screen,
  as wanted across a line's width.

## Timeline pacing

The arrival times have a long tail: 99% of stars are reached by ~15,000
years, and the last 0.1% take from ~23,000 to ~47,000, all of it a few
outlier stars thousands of ly out.  Linear in years, the visible spread
is over in the first third of the playback.  So the drawer paces the
timeline **by stars** by default: equal slider steps colonise equal
numbers of stars (`yearsAtProgress` interpolates the sorted arrival
times).  **By years** is the literal clock.  The years readout is exact
either way.

## Follow-ups

- Move the compute to a worker if `k` or the catalogue grows.
- Origins other than the Sun (the drawer could take the current target
  star).
- A fewest-years (Dijkstra) spread to compare with the fewest-hops one.
