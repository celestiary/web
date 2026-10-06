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
| `providers/PlacesProvider.js` | Surface places (cities, craters, landing sites) per body; lazy, loaded when a scope includes the body ([Places in the index](#places-in-the-index)) |
| `commitEntry.js` | `goToEntry`, `lookAtEntry` and `targetEntry`: what Go, Look at and a pick in the dropdown do with a result |
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

Tier C is the places: one Fuse per body, keyed by the body's rooted path
(`milkyway/sun/earth`), from `PlacesProvider.collectUnder`.  See below.

### Places in the index

A place is searchable from every scope that includes its body, so "austin"
finds Austin under Earth, under the Sun (the icon before Earth, with
Sun › Earth in the breadcrumb: the solar system) and from the root.

- `SearchIndex.ensureScope(anchorPath)` loads, once each, the places of every
  body in scope: `PlacesProvider.bodiesUnder` lists the loader's bodies with
  `has_locations` inside the scope, and `collectUnder` fetches
  `data/places/<body>.json` (`n`, `lat`, `lng`, optional `a` and `k`).  The
  SearchBar calls it when the scope changes and queries again when it
  resolves with a count; Earth is fetched only when a search is scoped to
  include it.
- `query` searches the Fuse of every loaded body in scope with Tier A's.
  From a scope wider than the body (the Sun's, the root's) a place's score
  is 0.1 worse, so bodies and stars that match as well come first.  Under
  Earth the Moon's places are in scope too.
- It was dead before this: Tier C was seeded under the loader's path
  (`sun/earth`) when a body was navigated to and read under the search's
  (`milkyway/sun/earth`), so no query ever saw it.
- A result is `kind: 'place'` with `payload {body, lat, lng, alt}` (`alt` only
  if the catalogue has one, so landing uses the eye-height default, as a
  click on the label does) and path `milkyway/sun/earth/austin`; the panel
  previews its body.

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

- **Planets, moons, the Sun:** `Scene.setTarget(name)`.  The breadcrumb,
  the info panel and the link follow the target, and a later `g` (or Go)
  travels there.
- **Stars:** `Scene.setTarget({kind: 'star', star, name})`, the same tween
  aimed at `worldGroup.localToWorld(starPosition(star))`; `g` travels to it.
- **Places:** `Scene.setTarget({kind: 'place', body, name, lat, lng, alt})`,
  the tween aimed at the surface point; `g` lands there.

All three are the one targeting function, `Scene.setTarget` (DESIGN.md
[the target](../../DESIGN.md#the-target)).

Zooming on the target is the FOV, which moves nothing, so a body's mesh LOD
must follow the FOV, not just the distance: `FovLOD` scales it
([DESIGN.md](../../DESIGN.md#the-far-point)).  Without that, Jupiter from
Earth stayed a far point at any zoom.

`c` (`lookAtTarget`) faces the target: a place, star or asterism
(`Shared.targets.label`), else `Shared.targets.obj`.  The aim is a
one-shot: a camera landed on a spinning body drifts off a distant target as
the body turns, unless tracking (`t`) is on.

## Picking a result, and the breadcrumb

Picking a result in the dropdown (a click, or arrows then a click) targets
it, of any kind, as a click on its label on the canvas does
(`targetEntry`: `Scene.setTarget` without the look; DESIGN.md
[Picking labels](../../DESIGN.md#picking-labels)).  The camera doesn't move;
the info panel, the link and, once the bar closes, the breadcrumb name it.
Escape leaves it targeted.  Go and Look at then act on it.

The breadcrumb is the target (`committedTarget`; `breadcrumbItems` in
`store/SearchSlice.js`): its body path, then a place's name
(Sun › Earth › Austin), or a star's or asterism's name alone.  Each element
links to its path in the hash (`#sun/earth/austin`, `#hip:32349`), which
goes there.

**What closes the bar.**  Any target change from outside it: a breadcrumb
link inside it, `h`, a hash edit, a click on a label on the canvas.  Its own
pick doesn't (SearchBar records the target its pick set and skips that
one), so the bar stays open on the pick, with the same scope: a result in
scope is under the anchor, so the breadcrumb's elements up to the anchor,
all that shows while it's open, are unchanged.  Go and Look at close it.
Before, a place pick targeted the point only and left the breadcrumb, as
any breadcrumb change closed the bar, and other kinds were only previewed.

The crosshair picker is untouched: its hover fills the field, its
double-click is still `scene.goTo(star, name)` (which targets it) + close
(`PickLabels`), and the Human Expansion widget ([#146]) opens the bar with
the picker on.

Layout: the field's 260 px minimum overflowed a phone, so under 500 px wide
(`index.css`) the open bar's field flexes and the row wraps; all four buttons
stay on screen.

## Commit flow (Go)

Planets and moons: `window.location.hash = loader.pathByName[name]` →
the hashchange listener → `Celestiary._navigate` → `setTarget` + `goTo`.

Stars: `scene.goTo(starProps, name)`, which targets the star.  Places:
`scene.land(body, lat, lng, alt, {target: place})`, which leaves the place
targeted.  Either way the link then names the target (`#hip:32349@…`,
`#sun/earth/austin@…`; [design/URLs.md](../../design/URLs.md#path)).

## Integration points outside this dir

- `store/SearchSlice.js` — all UI state (anchor, query, selection, preview,
  the target).  `committedTarget` is the target, and `committedPath` and
  `committedStar` views of it, all set by `setCommittedTarget`, which only
  `Scene.setTarget` calls.
- `ui/SearchBar.jsx` — the React component; reads index, drives Autocomplete.
- `Celestiary._registerSearchProviders` — registers providers; guards stars
  on `numStars > 0` with a local `registered` flag (catalog mutates in place
  so reference/value comparison both break).
- `Celestiary._subscribePreview` — single hub that renders the info panel;
  precedence `previewStar > previewPath > committedStar > committedPath`.
- `Scene.setTarget` — all targeting funnels here; sets `committedTarget`
  (with `_pathFor`'s path) so the breadcrumb follows the target.
- `scene/PickLabels.markCb` — crosshair double-click mirrors search commit:
  `scene.goTo(star, name) + closeSearch()`.

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
