# Human expansion

A what-if: humans leave the Sun at a fraction of light speed and spread
star to star across the catalogue (~107k stars).  The Widgets button
(top right) opens a drawer with the parameters, a play/scrub timeline and
stats; the spread is drawn like the asterisms, one line per hop.

| File | Holds |
|---|---|
| `Colonization.js` | the graph and the spread: k-d tree, kNN graph, bridging, layered BFS, timeline helpers (pure, tested) |
| `ColonizationLines.js` | the lines: one `LineSegments`, RTE, coloured by hop, grown in the shader |
| `../ui/ColonizationDrawer.jsx` | the drawer: parameters, playback, stats, legend |

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

- **Colour.** One colour per hop, stepped evenly along the longest path:
  near white (hop 1) through blue to near black (the last hop).  Display
  values, through `sceneReferred` (HDR.md), so the tone map gives them back.
- **Growth.** Each segment's child end moves from its parent star at
  departure to its own star at arrival (`aTimes`), so ships in transit
  show as growing lines, and a segment is discarded before departure.
  The timeline is one uniform (`uTime`): scrubbing rebuilds nothing.
- **RTE.** As the asterisms: float32 high + low positions about the
  camera, turned by `mat3(modelViewMatrix)`, a child of `Stars` in the
  `StellarFrame`.  Light-year coordinates stay exact, and the lines
  precess and rebase with the stars.
- **Visibility.** A scene annotation: the `x` setting (`x` key, in
  Settings under Labels) and so the global `V`.  Running a spread turns
  `x` back on.  The drawer is HTML chrome, so `v` hides it.

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
