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

- `Population.js`: the drawing, the groups, the label budget and the
  targets' nodes.  A subclass sets `positionAt(rec, jd, out)`.
- `../satellites/Satellites.js`: Earth's, by SGP4 from CelesTrak's elements.
- `Scene.addPopulation` (and `populationOf`, `onPopulationAdded`,
  `loadPopulation`, `setPopulationGroup`, `setPopulationLabels`,
  `getPopulationState`, `restorePopulations`): the scene's side.
- `ControlPanel.populationSectionHtml` and `_wirePopulation`: the panel's.
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
  name.
- **Names, by a budget:** the panel's slider sets how many show at once,
  from none to all in the shown groups.  The default is the number of the
  best known (`known`): three for Earth (the ISS, Tiangong and Hubble).
  - **Ranked:** the best known first, then by group in the data's order, then
    in the records' order.  Objects without a position are skipped.
  - **One sheet** for the budget's names, rebuilt when who's on it changes
    and laid on the objects each frame.  The declutter
    (`labelDeclutter.js`) ranks them 5 to 6, above places (1 to 4) and
    below bodies (1000 and up).
  - **The target's name** has its own sheet, and shows wherever the points
    show.
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
- **The link's state:** `pop:<body>=<group>+<group>,<body>.labels=N`.  It
  holds the groups shown when not all are, and the budget when it isn't the
  default ([design/URLs.md](../../../design/URLs.md#population-token)).  A
  link's state for a population not in yet is kept and applied when it's
  added, and written back meanwhile.
- **The panel:** a section under the body's (and its objects') panel, named
  by its title (`Satellites`): the group switches and the Names slider.  Its
  open or shut state is the `info:` token's, as for the other sections.

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

- `Satellites.test.js` (Earth's) covers the groups from the data, a group
  switched off hiding its points and names, the budget's ranking and its
  clamp to the shown groups, the target's own name, and the distance rules.
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
