# Populations round a body

A population is a set of objects round one body, drawn as points, with their
names and a way to show some groups and hide others.  Earth's satellites are
the first ([satellites/Satellites.md](../satellites/Satellites.md),
[#50](https://github.com/celestiary/web/issues/50)).  The Deep Space Network
dataset (spacecraft round other bodies, and its ground stations) and orbiters
round the Moon or Mars use the same mechanism.

`Population.js` is the generic part.  A population brings three things:

- **Its data:** its body, its groups' labels and colours, its records.
- **Where a record is at a date:** `positionAt`, the subclass's.
- **Its loader:** something that builds it and hands it to the scene.

The scene, the info panel, the search and the link work only through
what's here, so none of them changes for a new population.

## Files

- `Population.js`: the drawing, the groups and their counts, the label
  budget, the carrying when many are shown, and the targets' nodes.  A
  subclass sets `positionAt(rec, jd, out)`, and `stateAt` if it has the
  velocity to hand.
- `../satellites/Satellites.js`: Earth's, by SGP4 from CelesTrak's elements.
- `Scene.addPopulation` (and `populationOf`, `onPopulationAdded`,
  `loadPopulation`, `setPopulationGroup`, `setPopulationLabels`,
  `setPopulationCount`, `getPopulationState`, `restorePopulations`): the
  scene's side.
- `ControlPanel.populationSectionHtml`, `populationResultsHtml` and
  `_wirePopulation`: the panel's; `Celestiary._searchPopulation` and
  `_pickPopulation` its search.
- `../labelDeclutter.js` and `../labelPick.js`: the names' hold, the room a
  hidden one needs, and the behind-the-body rule (`declutterHold`,
  `labelOccluder`); `../SpriteSheet.js` `setFade`, their fade.
- `permalink.js` `encodePopulationToken` and `decodePopulationToken`: the
  link's `pop:` token ([design/URLs.md](../../../design/URLs.md#population-token)).
- `../../search/providers/SatellitesProvider.js`: the search, one provider a
  population.

## What a population is

```js
new MyPopulation(records, {
  body: 'mars',                 // whose planetTilt it hangs from
  title: 'Orbiters',            // the panel's section
  groups: {                     // by key, in the panel's order
    nasa: {label: 'NASA', kind: 'NASA orbiter', color: '#ffffff'},
    esa: {label: 'ESA', color: '#c0d0ff'},
    // A counted group: the first 300 in the records' order show to start.
    cubesats: {label: 'Cubesats', count: 300, orderedBy: 'launch'},
  },
  showDist: 5e8,                // points nearer than this to the body's centre, m
  labelDist: 1e8,               // names nearer than this
  layer: Shared.OVERLAY_LAYER,
  camera: ui.camera,
})
```

- **A record** is `{id, name, group}`.  It can also carry `label` (the name
  to show, if not the catalogue's), `aliases` (more names for the search),
  and `known` (one of the best known, named first).  `id` is unique within
  the population, and a record's group is a key of `groups`; a group not
  listed is drawn grey under its key.
- **`positionAt(rec, jd, out)`** sets `out` to where the record is at the
  Julian Day (UTC), in the body's equator frame under its planetTilt (+Y the
  pole, +X the equinox of date for Earth, the IAU node for other bodies),
  in metres.  It returns false where there is no position (outside the
  data's span), and the object isn't drawn there.  Earth's satellites use
  SGP4 and the TEME remap; a spacecraft with an ephemeris would interpolate
  it.
- **Hang it** with `scene.addPopulation(pop)`.  That hangs it from its
  body's planetTilt (now, or when the body loads), joins it to the orbits
  group (`o`), applies a link's `pop:` state for its body, makes its
  changes rewrite the link, registers its search entries, and shows the
  panel's section if its body is the target.  Earth's satellites come in
  this way (`Scene.loadSatellites`).

## What every population gets

- **Points**, a 3.5 px dot each in its group's colour, on the overlay layer
  with depth testing, so the body hides those behind it.  They show while the
  camera is within `showDist` of the body's centre and `o` is on.
- **Groups:** the panel lists each with its colour and count as a switch.  A
  group switched off hides its points and its names.  A hidden group's
  object can still be targeted (search, link), and its target keeps its
  name.  A group can be counted ([below](#counted-groups)).
- **Names, by a budget:** the panel's slider sets how many show at once,
  from none to all in the shown groups.  The default is the number of the
  best known (`known`): three for Earth (the ISS, Tiangong and Hubble).
  - **Ranked:** the best known first, then by group in the data's order, then
    in the records' order.  Objects without a position are skipped.
  - **One sheet** for the budget's names, rebuilt when who's on it changes
    and laid on the objects each frame.  The declutter
    (`labelDeclutter.js`) ranks them 5 to 6, above places (1 to 4) and
    below bodies (1000 and up).  How they keep still: [below](#names-that-hold-still).
  - **The target's name** is its label on that sheet when the budget names
    it: targeting one doesn't rebuild the sheet or draw the name again (the
    declutter puts the target's first).  Only a target the sheet doesn't
    name (past the budget, its group hidden or past its count, or the names
    too far to show) gets a one-name sheet of its own, which shows wherever
    the points show.  Before PR #292's second round the target always had
    its own sheet and left the budget's, which was rebuilt on every pick.
  - The names show within `labelDist`.
- **Targets:** `{kind: 'satellite', id, name, body}` (`targetOf`), through
  `Scene.setTarget` like every target.  The body is `Shared.targets.obj`
  and the object is `Shared.targets.label`, as for a place.  A go hangs the
  camera on the object's node (`node(id)`), made on first use, arriving
  `node.arrivalDistance` (300 km) off, above it unless the line in already
  is.  It rides the object in the body's frame, and `f` off leaves the
  camera with the body.  A model (#25) would hang from the node.
- **Links:** the path is `sat:<id>` round Earth and `sat:<body>:<id>` round
  any other body (`targetPath.js`).  The frame is the body's.
- **The link's state:** `pop:<body>=<group>+<group>,<body>.labels=N,<body>.<group>=N`.
  It holds the groups shown when not all are, the budget when it isn't the
  default, and a counted group's count when it isn't its default
  ([design/URLs.md](../../../design/URLs.md#population-token)).  A
  link's state for a population not in yet is kept and applied when it's
  added, and written back meanwhile.
- **The panel:** a section under the body's (and its objects') panel, named
  by its title (`Satellites`): the search, the group switches, a slider for
  each counted group and the Names slider.  Its open or shut state is the
  `info:` token's, as for the other sections.

## Counted groups

A group whose data gives a `count` shows only its first that many, in the
records' order, and the panel gives it a slider from none to all
(`setGroupCount`, `groupCount`, `defaultGroupCount`).  Starlink's 11,116
are the first: ordered by serial number by the tool that builds the data,
300 to start.  The order is the data's (the tool sorts the rows), so the
app knows only "the first n"; `orderedBy` is what the panel says it is
("300 of 11,116, by serial number").

- **The slider** is square-root spaced over 1000 steps
  (`ControlPanel.countToSlider`, `sliderToCount`): its first step is one,
  its last all, and the low counts are as easy to reach as the high.
- **A count bounds the names' budget**, as a hidden group does.
- **Its records past the count** aren't drawn or propagated, but are still
  searched and can be targeted, as a hidden group's.

## Many shown

Over 2,000 shown, propagating each every frame costs too much (SGP4 is
about 2 µs a satellite: Starlink whole, 17 to 30 ms).  So those on
near-circular orbits (`eccentricity` under 0.01) are carried:

- **Worked out exactly in turn**, 2,500 a frame (`_refreshInTurn`): each
  gets its position and velocity (`stateAt`), from which its circle: the
  radius `p`, a quarter turn on `q = k × p` (`k` the orbit's pole, `p × v`
  normalised) and the rate `ω = |p × v| / |p|²`.
- **Carried between**, by `p cos ωt + q sin ωt`: a few multiplications each.
  Exact on a circle; for Starlink, within 0.12 km of SGP4 after 10 s and
  0.7 km after a minute, where a refresh comes round every four or five
  frames.
- **Never carried more than an hour** (J2 turns a low orbit's plane a few
  degrees a day): past that, or with no position yet, it's worked out
  within the frame's budget, and not drawn until it is.  So "all" fills in
  over three frames, not with a 25 ms frame.
- **Everything else** is worked out every frame: an eccentric orbit
  (Molniya), and the nodes and names' target, which are exact.
- **`stateAt` by default** takes `positionAt` a minute apart, and the
  velocity along the circle through the two, so the turn is right however
  coarse a Julian Day's last digits are (a second's difference of positions
  came out 26 m off after 10 minutes, from them).  Satellites give SGP4's
  velocity.

## Names that hold still

Hundreds of names round a body move against each other.  Three faults made
them pop on and off (PR #292, reported at Starlink alone with 300 names,
`…;pop:earth=starlink,earth.labels=300`):

- **Names behind the body took room.**  They're depth-tested away, but the
  declutter counted them, so a name hidden behind Earth hid the names in
  front where they crossed on screen.  At the reported view 21 of the 46
  names drawn were behind Earth.  Now the sheet carries
  `userData.labelOccluder` (the population, with `bodyRadius`, which
  `Scene` sets from the body's radius when it hangs the population):
  `labelPick.labelBoxes` leaves out a name whose line from the eye meets
  the body's sphere first (`behindSphere`; from under the radius, the
  sphere is taken just under the eye), and the declutter hides it.
- **A shown name gave way to a hidden one** whenever the hidden one ranked
  higher and came to touch it, which a pixel's drift does, and each change
  ran down the ranks.  Now the sheet holds (`userData.declutterHold`, a rank
  added to each name shown last frame): a shown name gives way only to a
  more important one it comes to touch.  A hidden name comes back only
  where there's 6 px to spare beyond the gap (`SHOW_PAD_PX`), except on
  the sheet's first pass, which packs it from nothing.
- **Names cut at the limb.**  A name whose point was just past the limb lost
  the part of it over the body to the depth test ("NK-5108").  The names
  aren't depth-tested now: the behind-the-body rule hides the ones the
  body hides.  (With the declutter switched off, the perf overlay's
  `labels`, those behind show through.)

And a name fades in and out over 200 ms (`SpriteSheet.setFade`,
`stepFade` from `update`), where it used to switch.  A rebuilt sheet keeps
each name that stays as it was, shown or not, mid-fade or not; a new one
starts hidden and fades in once the declutter shows it.

## Names by distance

A population with a `labelStyle` (DESIGN.md, [label
styles](../../../DESIGN.md#label-styles)) draws each name at a size and
brightness by its distance from the camera, and ranks it by the same
measure where two touch: the nearer wins (`_styleNames`, each frame the names
show).  Earth's satellites have one (`SATELLITE_LABELS`): 14 px at 1,000 km
or nearer, 11 px and half as bright at 50,000 km or farther, by the
distance's logarithm.  The target's name is at its largest and brightest
wherever it is.  A population without one draws its names alike, ranked by
the budget's order.

- **Fixed ranges**, not ranges taken from what's on screen: a name keeps
  its look as the view turns, and the same distance looks the same in
  every view.  From outside the shell (Earth's satellites from 16,000 km)
  every name is about as far as the others, and they all come out small
  and dim alike; from 1,000 km over one, it is the largest and the far
  side of the shell the smallest.
- **Measured** at the reported views, the same frames before and after:

  | view | names shown, before | after | text per name |
  |---|---|---|---|
  | Starlink, 300 named, from 16,000 km | 39 | 48 | 1,531 → 807 px² |
  | all 11,116 named, from 7,200 km up | 75 | 119 | 1,567 → 829 px² |

  The second view renders black on SwiftShader (a shader there doesn't
  validate, as on `main`), so it has numbers and no picture.

## Search

The section's search box finds the body's population alone: the main
search's index (`searchIndex.query`, scoped to the body's path), its
population's results kept.  A click or Enter targets one, as a pick in the
main search does (`commitEntry.targetEntry`); a double click goes, as on
its label.  The query stays through the panel's redraw that the pick
causes.  The arrows move through the results; Escape clears it.

The provider (`SatellitesProvider`, for any population) puts the groups
shown whole into the search's fuzzy index, and searches every object itself
by its names' characters (js/search/DESIGN.md,
[populations](../../search/DESIGN.md#populations)): Starlink's thousands
are a tenth of a second a keystroke through the fuzzy index, and fuzzy
matching can't tell STARLINK-30930 from STARLINK-30931 anyway.  The main
search gets the same results from any scope that includes the body.

## Adding one (the Deep Space Network, Mars orbiters)

1. A data file with the body, the groups and the records, built by a tool
   under `tools/`, its source and terms recorded in a doc beside it.  Bundle
   it or fetch it by the data policy (DESIGN.md
   [data policy](../../../DESIGN.md#data-policy)).
2. A subclass of `Population` with `positionAt`, and its own label and
   distance defaults.
3. A loader that builds it when something needs it (DESIGN.md [what loads
   when](../../../DESIGN.md#what-loads-when)) and calls
   `scene.addPopulation`.  If a `sat:<body>:<id>` link should load it, add
   it to `Scene.loadPopulation`.
4. Nothing in the panel, the search or the link.  Ground stations, which
   don't orbit, would be places (`places.md`) or a population whose
   `positionAt` is fixed in the body's frame.

## Checked

- `Population.test.js`: a counted group (the first n shown, the budget
  bounded, the default and the slider's clamp); few shown worked out each
  frame; thousands carried, a frame's budget worked out in turn, within
  5 m of exact on circles ten minutes on; an eccentric orbit and one
  carried too long worked out exactly.
- `labelDeclutter.test.js`: the hold (and that it never lifts a satellite's
  name over a body's), the room a hidden name needs and not on the first
  pass, and the behind-the-body rule, from outside the sphere and inside
  it.  `SpriteSheet.test.js`: the fade.
- `Satellites.test.js`: a target the budget names keeps its label (the same
  sheet, no other), and gets its own once the names are too far; a rebuild
  keeps each staying name's state.  `ControlPanel.test.js`: the search,
  its redraw and its picks, and a counted group's slider.
  `Scene.satellites.test.js`: a counted group's count kept for the link and
  restored, and the body's radius given.
- In the browser (headless Chromium), at the reported view with the clock
  stepped by hand, 3 s at 60 frames a second:

  | | before | after |
  |---|---|---|
  | names drawn | 46, 21 of them behind Earth | 39, none behind |
  | changes, at 1× | 2 | 0 |
  | changes, at 100× | 386 | 71 |
  | names flipping more than once, at 100× | 124 | 23 |

  (`screens/satellites-50/labels-before.png`, `labels-after.png`.)
  Picking a name the budget shows: the same sheet, no second label, the name
  fading in over two frames.

- `Satellites.test.js` (Earth's) covers the groups from the data, a group
  switched off hiding its points and names, the budget's ranking and its
  clamp to the shown groups, the target's name, and the distance rules.
- `Scene.satellites.test.js` covers Earth's and a Mars population (fixed
  positions, two groups).  Mars's: hung from its tilt, in `o`, targeted with
  Mars as the body, gone to and left in Mars's frame.  A link's state is
  kept before the population is in, applied when it's added and written
  back, and the panel's controls rewrite the link.
- `ControlPanel.test.js` covers the section from a population and the
  switches and slider through the hooks; `permalink.test.js` covers the
  `pop:` token round a whole link; `Celestiary.test.js` covers a link's
  `pop:` kept and written back before the population is in.
- In the browser (headless Chromium): the switches clicked down to
  Starlink alone and the slider moved to 40.  That drew 300 with 40 names,
  and the link `…;info:open=population;pop:earth=starlink,earth.labels=40`
  reopened to the same switches, slider and scene.
