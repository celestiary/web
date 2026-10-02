# Search Module

Breadcrumb-anchored search over celestial bodies and star catalog entries.
Extensible via a provider interface so future surface-place data (cities,
craters on Earth/Mars) can be plugged in without re-architecting.

## Directory layout

| Path | Role |
|---|---|
| `SearchProvider.js` | JSDoc typedefs for `SearchEntry` and the provider contract |
| `SearchRegistry.js` | Singleton provider list — `register`, `list`, `_reset` (test-only) |
| `SearchIndex.js` | Tiered index, query, per-anchor cache; exports the app-wide singleton `searchIndex` |
| `providers/SceneProvider.js` | Entries for every body in `Loader.loaded` (sun, planets, moons, galaxy nodes) |
| `providers/StarsProvider.js` | Entries for named stars + exact HIP resolver |
| `providers/PlacesProvider.js` | Stub for future surface-place data (lazy, `collectUnder`-only) |
| `commitEntry.js` | `goToEntry` and `lookAtEntry`: what the Go and Look at buttons do with a result |
| `SearchIndex.test.js` | Scoping, fuzzy, HIP-exact, dedupe coverage |
| `commitEntry.test.js` | Go calls `goTo`/`land`/the hash; Look at calls the target path and never `goTo` |

## Data model

A `SearchEntry` is the atomic unit:

```js
{
  id: 'earth' | 'hip:32349' | 'loc:earth:paris',
  displayName: 'Earth',
  aliases: ['terra', 'gaia', ...],
  kind: 'galaxy'|'star'|'planet'|'moon'|'place',
  path: 'milkyway/sun/earth',       // rooted '/'-joined path
  parent: 'sun',                     // parent id, or null
  payload: {...},                    // kind-specific navigation hint
}
```

The `path` is what lets subtree scoping work — any entry is "in scope" for
an anchor if `entry.path === anchorPath || entry.path.startsWith(anchorPath + '/')`.
The trailing slash guard is load-bearing: a bare `startsWith` would match
`'milkyway/sunflower'` against anchor `'milkyway/sun'`.

## Tiered index

Three tiers with different cost/latency tradeoffs:

| Tier | Source | Use | Cost |
|---|---|---|---|
| A | All non-lazy providers' `collectAll()` | Typed-query fuzzy matching | ~50 ms build, <20 ms per keystroke at ~8k entries |
| B | `StarsProvider.resolveHip(n)` | Exact numeric / `HIP N` input — short-circuits Fuse | O(1) |
| C | Lazy providers' `collectUnder(anchorPath)` (per-anchor `Fuse` cache) | Surface-place search scoped to a body | Paid once per anchor |

Tier A is populated once on first `ensureReady()`. Star catalog only
contributes *named* stars (~8k) to Tier A; full 120k fuzzy-scan would be
200–500 ms per keystroke and unnamed stars have nothing meaningful to fuzzy
match against. Unnamed stars are still reachable via Tier B (numeric input).

Tier C is empty today — `PlacesProvider` is a stub. It exists so the index
doesn't need restructuring when place data lands.

## Fuse.js configuration

```js
{
  includeScore: true,
  ignoreLocation: true,     // critical — default location weighting breaks 'HIP 32349'
  threshold: 0.35,          // one-typo tolerant on short names
  minMatchCharLength: 2,
  keys: [
    {name: 'displayName', weight: 0.7},
    {name: 'aliases',     weight: 0.3},
  ],
}
```

`ignoreLocation: true` is mandatory. Without it Fuse penalises matches that
aren't near the start of the field, which tanks alias-based lookups.

## Scoping semantics

The search bar has an *anchor* — the path element the icon is sitting
before. Anchor position is an index into the breadcrumb:

| Icon position | anchorIndex | anchorPath | Scope |
|---|---|---|---|
| before Sun (default) | 0 | `milkyway` | everything (peer stars + solar system + future places) |
| before Earth | 1 | `milkyway/sun` | solar system (Earth + siblings + their descendants) |
| before Moon | 2 | `milkyway/sun/earth` | Earth subtree (Moon + future places on Earth) |

`anchorPathFor(committedPath, anchorIndex)` in `store/SearchSlice.js`
produces the rooted string the index consumes.

## Go and Look at

The expanded bar has two actions on the selected result, both disabled until
one is selected:

| Button | Icon | aria-label | Does | Code |
|---|---|---|---|---|
| Go | arrow | "Go to" | Travels to the result.  Enter in the field does this too. | `goToEntry` |
| Look at | magnifier | "Look at" | Targets the result and turns the camera in place to centre it.  The camera doesn't move. | `lookAtEntry` |

Look at is for orientation debugging: from Earth, search Jupiter, press it,
and Jupiter is centred; narrow the FOV to zoom on it from where you stand
(which face of a body, or of a moon, points at the viewer).  Like Go, it
closes the bar.

It reuses the `c`/`0`-`9` path, not a second implementation: the same
rotation-only `newCameraLookTween` (600 ms, roll kept), with no rebase and
no reparent, so the camera position is untouched
([DESIGN.md](../../DESIGN.md#settarget-lookattarget-c-key)).  The tween
slerps by the shortest arc, so a target below the horizon or behind the
camera still turns to face it.  Per kind:

- **Planets, moons, the Sun:** `Scene.setTarget(name)`.  It also syncs
  `committedPath`, so the breadcrumb and info panel follow the target and a
  later `g` (or Go) travels there.
- **Stars:** `Scene.lookAtStar(star)`, the same tween aimed at
  `worldGroup.localToWorld(starPosition(star))`, because a star has no scene
  object to `setTarget`.  `setCommittedStar` follows, as for Go, so `g`
  travels to it.
- **Places:** `Scene.lookAtPlace(body, lat, lng, alt)` targets the body and
  aims the tween at the surface point.

`c` (`lookAtTarget`) looks at `Shared.targets.obj`, so after targeting a star
it still means the last body, not the star.  The aim is a one-shot: a camera
landed on a spinning body drifts off a distant target as the body turns,
unless tracking (`t`) is on.

The crosshair picker is untouched: its hover fills the field, its
double-click is still `scene.goTo` + `setCommittedStar` + close (`PickLabels`),
and the Human Expansion widget ([#146]) opens the bar with the picker on.

Layout: the field's 260 px minimum overflowed a phone, so under 500 px wide
(`index.css`) the open bar's field flexes and the row wraps; all four buttons
stay on screen.

## Commit flow (Go)

Planets and moons: `window.location.hash = loader.pathByName[name]` →
existing hashchange listener → `loadPath` → `onDone` → `setCommittedPath`.
The hash routing is the single source of truth for planet permalinks.

Stars: `scene.goTo(starProps)` + `setCommittedStar({hipId, displayName,
star})`. Stars aren't hash-routed; the store field carries the committed
identity.

## Integration points outside this dir

- `store/SearchSlice.js` — all UI state (anchor, query, selection, preview,
  committed path/star). `setCommittedPath` and `setCommittedStar` are
  mutually exclusive.
- `ui/SearchBar.jsx` — the React component; reads index, drives Autocomplete.
- `Celestiary._registerSearchProviders` — registers providers; guards stars
  on `numStars > 0` with a local `registered` flag (catalog mutates in place
  so reference/value comparison both break).
- `Celestiary._subscribePreview` — single hub that renders the info panel;
  precedence `previewStar > previewPath > committedStar > committedPath`.
- `Scene.setTarget` — all target-setting funnels here; syncs `committedPath`
  via `_pathFor` so breadcrumb follows the target (and clears
  `committedStar`).
- `scene/PickLabels.markCb` — crosshair double-click mirrors search commit:
  `scene.goTo(star) + setCommittedStar(...) + closeSearch()`.

## Adding a new provider

Implement the `SearchProvider` interface:

```js
class MyProvider {
  id = 'my'
  lazy = false         // true if per-anchor only
  async preload() {}   // optional — pre-warm any lazy data
  collectAll() {       // required when lazy === false
    return [/* SearchEntry, ... */]
  }
  // or, for lazy providers:
  collectUnder(anchorPath) {
    return [/* SearchEntry, ... */]
  }
}
```

Register in `Celestiary._registerSearchProviders` (or an appropriate ready
hook for async-loaded data). Call `searchIndex.invalidate()` after
registration so Tier A rebuilds.

## Test strategy

- Unit — `SearchIndex.test.js` exercises scoping, Fuse thresholds, HIP exact
  path, dedupe, and anchor-scope edge cases (`sun` vs `sunflower`) against
  stub providers.
- Unit — `SearchSlice.test.js` covers mutual-exclusivity of
  committed/preview fields and openSearch/closeSearch transitions.
- Unit — `scene/Scene.test.js` exercises `_pathFor` against synthetic
  object graphs including cycles.
- Manual — catalog build + query are exercised end-to-end only in the
  browser (no WebGL test harness).
