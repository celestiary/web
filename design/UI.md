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
of sky kept).  Drag the grabber or the head, or tap it to step.  The bottom
controls and the settings buttons sit above the sheet at its peek, and hide
while it is raised, so nothing overlaps it; the sheet sits above the widgets
drawer's sheet when both are open.

## Phases

1. **Tokens, the tiered panel, the phone sheet** (this change).  Bodies,
   stars and galaxies all use the new panel.
2. **The observing (red) theme**: a setting and a permalink letter, every
   token's red value, offered when AR starts after dark.
3. **The phone dock**: the time panel, layers, AR and widgets in one bottom
   bar; the time readout in mono; the breadcrumb to its last two chips.
4. **AR**: the reticle, the identify card, labels with a halo and only the
   brightest named, Cesium's credits in the sheet.
5. **The homepage and the rest of the chrome on tokens**; retire `.dialog`,
   `.text-label`, `collapsor.js`.
