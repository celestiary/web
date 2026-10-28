# The interface: design system and redesign plan

The app's chrome takes its look from the homepage (title, search, scene
cards): dark glass over the scene, periwinkle as the one signal colour,
Inter, borders rather than shadows.  The design system that writes that down,
with its tokens, components and the proposed panels below, is a Design
System artifact:
[Celestiary design system](https://claude.ai/artifact/V3W7dATv44iE3gHrAYxGWy)
(its README is the brand book; its `tokens.json` the values).  This file is
the plan for bringing the app in line with it, and the record of what has
landed; the epic is [#279](https://github.com/celestiary/web/issues/279).

## Principles

1. **The sky is the ground.** UI floats on the scene; it never paints a page
   background.
2. **Night first.** No white fills, no large areas of colour; pure white only
   for headlines and labels.
3. **Quiet chrome, exact data.** Numbers in mono, tabular, colour-keyed to the
   scene's lines.
4. **Reveal by intent.** A name first, a few numbers when asked, everything
   only on request.
5. **One thing on top.** Nothing draws over a panel or sheet.

## Tokens in the app

`js/index.css` declares the system's tokens as CSS custom properties on
`:root`, under the same names (`--accent`, `--ink-3`, `--surface-sheet`,
`--space-16`, `--radius-card`, `--row`).  New CSS uses them, never raw
values; the homepage's rules keep their literals until they are next
touched (the values are the same).  Numbers are set in IBM Plex Mono
(`--font-mono`, loaded with Inter in `public/index.html`).

## The info panel, in tiers

The target's facts were a bulleted dump of its descriptor, every field and
`[+]` toggle at once, in a translucent card that the scene's labels and the
bottom controls showed through.  It is now revealed in tiers
(`ControlPanel`, `js/infoPanel.js`):

| Tier | Shows | Where |
|---|---|---|
| Glance | name, kind, one fact | the panel's head; the phone sheet at its peek |
| Summary | a sentence and 2–5 key rows | the panel open |
| Detail | sections (Orbit, Physical, Space around, Atmosphere, More data), closed by default | one tap each |
| Source | the raw descriptor | the guide; "More data" keeps the leftovers meanwhile |

- **Rows**: label left in words people use ("Day", not
  `siderealRotationPeriod`), the value right in mono, the unit quiet.  The
  orbit's elements keep their colour, as a short line that matches the line
  in the scene, and stay switches (click, Enter, Space; hover previews).
- **Sections** are `<details>`; which are open is still the `info:` token
  ([URLs.md](URLs.md#info-token)), named as before by their place in the
  props (`orbit`, `atmosphere`, `space`, `system`), plus the new `physical`
  and `more`.  `closed` folds the panel to its head.
- **Surface**: `--surface-sheet` (97% opaque), so no label or line reads
  through it.

## Phones: the bottom sheet

At 600px wide or less (`useIsMobile`), the panel leaves the top-left and
becomes a sheet from the bottom with three heights: **peek** (the head: name,
kind, one fact), **half** (the summary) and **full** (88% of the scene, a strip
of sky kept).  Drag the grabber or the head, or tap it to step.  It sits on
the dock (below), and on the widgets drawer's sheet when that's open, so
nothing overlaps it.

## Phones: the dock

At 600px wide or less the controls that floated down the right of the screen
(the widgets button, the time panel and its five buttons, the drag mode pair,
layers, AR) and the settings and About buttons bottom-left collect into one
bar along the bottom (`js/ui/PhoneDock.jsx`), 56px over the safe area:

| Button | Shows | Tap |
|---|---|---|
| Time | the sim clock, `4:19 PM`, and its rate when not real time | the time panel above the bar: date, rate, rewind, now, pause, forward, calendar |
| Layers | only near a Cesium body | the layer tiles above the bar |
| AR | the AR sky view | enters it; while on, its controls (calibrate, damping, exit) sit above the bar |
| Apps | the widgets drawer | opens or closes it, as a sheet above the bar |
| More | | drag mode, Settings, About, above the bar |

- One panel above the bar at a time; a second tap on its button, or a tap on
  the scene, closes it.
- The scene stops above the bar (`Celestiary.setInsets`' bottom takes its
  height, from the store's `phoneDockHeight`), so nothing important is drawn
  under it; the widgets sheet sits on the bar, and the info sheet and the
  credits footer on the whole dock, an open panel too
  (`--phone-dock-height`), so a panel lifts them rather than covering them.
- It's chrome: held on the homepage, faded with the rest, hidden by `v`.
- Desktop is unchanged.

## The credits footer

Every attribution on screen is in one line along the bottom edge, as a map's
(Google Maps' "Imagery ©2026 …, Map data ©2026 Google"): small, low
contrast, right-aligned (`js/ui/CreditsFooter.jsx`, `js/credits.js`).

- **What's in it**, each only while its data is drawn: Cesium's credits
  first (the ion logo, the imagery's and terrain's providers, its *Data
  attribution* list; CESIUM.md [credits](../CESIUM.md#credits)), then
  celestiary's own: New York's "© OpenStreetMap contributors (ODbL)" and
  "NYC Open Data" while the city is drawn, a `·` between them.  Empty, the
  footer isn't laid out.
- **The registry** (`credits.js`): `addCredit(id, credit, {order})` and
  `removeCredit(id)`.  A credit is `{text, href}` (a link only if http(s)),
  a list of them, or `{element}`, an element a library keeps up to date
  itself (Cesium's `CreditDisplay` writes into `#cesium-credits`, which the
  footer mounts as it is).  Lower `order` first (Cesium's 0, the rest 10),
  then by when added.  A layer that brings data with a licence asking for
  credit adds its own here while that data is drawn.
- **The look**: 11px Inter (`--credits-size`) on a 20px line
  (`--credits-line`), `--ink-3` on `--surface-veil` (the surface at 75%),
  which holds about 4.4:1 over a sunlit day side and stays quiet on the
  night sky; links in the same ink, underlined on hover.  The ion logo is the
  line's height (`--credits-logo`, 20 of its 28 px); other providers' logos
  stay as Cesium draws them.
- **Where**: the bottom edge, from `--credits-left` (128px, clear of the
  settings and About buttons bottom-left) to the widgets drawer
  (`--dock-width`).  On a phone (600px or less) the whole width, above the
  dock and both sheets (`--phone-dock-height`, `--sheet-height`,
  `--info-sheet-bottom`), wrapping rather than cut: Bing's terms forbid
  obscuring its attribution, so nothing is behind a tap.
- **Chrome**: held through the first load and on the homepage (no credits
  there anyway: the Cesium layers are suspended), faded in with the rest at
  the reveal, out with the changelog tour, hidden by `v` (`html.chrome-hidden`,
  `Celestiary._navDisplay`'s `CHROME_PANEL_IDS`).  It's mounted from the
  start, so Cesium's credits have somewhere to go whenever a layer loads.

## Phases

1. **Tokens, the tiered panel, the phone sheet** (done, #280).  Bodies,
   stars and galaxies all use the new panel.
2. **The observing (red) theme**: a setting and a permalink letter, every
   token's red value, offered when AR starts after dark.
3. **The phone dock** (done, above): the time panel, layers, AR, widgets
   and settings in one bottom bar, the clock in mono.
4. **AR**: the reticle, the identify card, labels with a halo and only the
   brightest named, Cesium's credits in the sheet.
5. **The homepage and the rest of the chrome on tokens**; the breadcrumb to
   its last two chips on a phone; retire `.dialog`, `.text-label`,
   `collapsor.js`.
