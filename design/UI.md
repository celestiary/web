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
`:root`, under the same names (`--accent`, `--ink-3`, `--surface`,
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
- **Surface**: `--surface`, opaque, so no label or line reads through it (the
  system's `surface-sheet`, 97% opaque, still let a bright label show).

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
| More | | drag mode, the red light, Settings, About, above the bar |

- One panel above the bar at a time; a second tap on its button, or a tap on
  the scene, closes it.
- The scene stops above the bar (`Celestiary.setInsets`' bottom takes its
  height, from the store's `phoneDockHeight`), so nothing important is drawn
  under it; the widgets sheet sits on the bar, and the info sheet and
  Cesium's credits on the whole dock, an open panel too
  (`--phone-dock-height`), so a panel lifts them rather than covering them.
- It's chrome: held on the homepage, faded with the rest, hidden by `v`.
- Desktop is unchanged.

## Phones: the breadcrumb

A path of four or more (Sun › Earth › Moon › Tranquility Base) shows on a
phone as a "…" chip and its last two (… › Moon › Tranquility Base), on one
line; a tap on the "…" shows the whole path until the target changes, and the
open search, which scopes by the path, shows it whole.  A path of three shows
whole: a "…" would hide one chip.  Only the chip with the search icon keeps an
icon slot, there being no hover to move it.

## The observing (red) theme

For using the app outdoors at night, as through a red torch: only red light
leaves the screen, so the eye keeps its dark adaptation (the rods don't see
red).  Everything goes red, the sky and the planets as well as the chrome:
each pixel shows its brightness on the red channel alone.

- **Switch**: `r`, Settings' *Display* group, and the dock's *Red light* on a
  phone.  The device remembers it, and a link carries it as `R` in `s=`
  ([URLs.md](URLs.md#view)); a link turns it on, never off, so a screen
  outdoors at night never flashes white.
- **Offered** when AR starts on Earth after dark (the Sun below −6°): a card
  above the dock, *Red light* or *Not now*, once a page.
- **The tokens don't change**: the night theme's colours map by brightness,
  which keeps the ink's steps (`--ink` to `--ink-4` become reds of 229, 194,
  179 and 154).  The system's `observing` values are what the night ones become.
- **Contrast**: red light tops out at 5.25:1 on black (pure red is a fifth as
  bright as white), so in red only white text passes 4.5:1, and `--ink` is
  4.3:1.  Series still differ by brightness and are always labelled.
- How it's drawn: DESIGN.md [the observing theme](../DESIGN.md#the-observing-red-theme).

## Phases

1. **Tokens, the tiered panel, the phone sheet** (done, #280).  Bodies,
   stars and galaxies all use the new panel.
2. **The observing (red) theme** (done, above): a setting and a permalink
   letter, the whole screen in red, offered when AR starts after dark; with
   it the phone's breadcrumb, from phase 5.
3. **The phone dock** (done, above): the time panel, layers, AR, widgets
   and settings in one bottom bar, the clock in mono.
4. **AR**: the reticle, the identify card, labels with a halo and only the
   brightest named, Cesium's credits in the sheet.
5. **The homepage and the rest of the chrome on tokens**; retire `.dialog`,
   `.text-label`, `collapsor.js`.
