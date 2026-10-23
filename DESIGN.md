# Celestiary Architecture

## Overview

Celestiary is a web-based astronomical simulator — an interactive 3D solar system and star field viewer. It renders real-scale celestial objects in WebGL via Three.js, animates orbital mechanics using VSOP87 planetary theory, and presents a React/MUI UI overlay for navigation and controls.

## Technology Stack

| Concern | Library/Tool |
|---|---|
| 3D rendering | Three.js 0.171 (WebGL2) |
| React framework | React 18 + React DOM |
| UI components | MUI v5 (Material UI) |
| Routing | Wouter 3 (hash-based for celestial targets, path-based for app sections) |
| State management | Zustand 4 |
| Animation tweening | @tweenjs/tween.js |
| Orbital mechanics | vsop87 package (a chunk of its own, loaded after the first frame) + Standish's mean elements as the stand-in before it, and for Pluto and the moons |
| Build | esbuild (custom config in `esbuild/`) |
| Test runner | Bun test |
| Linting | ESLint 9 (Google style + JSDoc + jsx-a11y) |

## Top-level Entry Points

```
js/index.tsx        Root React mount: Style -> Routed
js/Routed.jsx       Path router: '/' -> App, '/guide' -> Guide (lazy-loaded)
js/App.jsx          Main simulator UI shell
js/guide/Guide.jsx  Interactive tutorial/demo sections
```

## Application Bootstrap Flow

1. `index.tsx` mounts `<Root>` → `<Style>` → `<Routed>`
2. `Routed` uses Wouter to lazy-load either `App` (simulator) or `Guide` (tutorial)
3. `App` instantiates the `Celestiary` controller on mount, passing DOM refs for the canvas container and nav panel
4. `Celestiary` decides the scene settings (the link's `s=`, else the defaults: `Scene.initSettings`), wires together all subsystems and calls `load()` to fetch the initial target (the link's; at the bare URL, the [homepage](#homepage) and its tour)

### The first load

A sequence, not everything at once ([#238](https://github.com/celestiary/web/issues/238)):

1. **The page, in the user's theme, dimming to black.**  `public/index.html` declares `color-scheme: light dark` and paints `Canvas`/`CanvasText` first (inline, before any stylesheet or script), so the first paint is the user's own light or dark; two frames later `html.page-up` transitions it to black over 500 ms: a dim for a light theme, nearly nothing for a dark one, never a white flash or a hard cut.
2. **The title, and the Moon going round its phases** under it (🌑 to 🌘, 120 ms each, a turn a second, in grey: the `loading-moon` script; one phase held for reduced motion), styled in the page itself (so it's right before any CSS or code loads): fades in after 300 ms, so a fast load doesn't flash it.  It said "Loading…" until the maintainer asked for something less nuts and bolts.  React's `Suspense` fallbacks are empty.  A link with the HUD off (`v` in its `s=`) shows no loading text at all: the user has turned everything off, so the page stays black until the scene fades in (`quiet-load` in `public/index.html`, which reads the fragment before the first paint; `js/quietLoad.test.js`).
3. **The reveal** (`choreography.js`, run from the animation loop's clock, not timers) starts once the camera is placed (`_arrive`) and the scene is in (`ThreeUi.sceneReady`: the star catalogue drawn, its bright tier and whatever the view shows past it ([the star catalogue's tiers](#the-star-catalogues-tiers)), and the target's surface loaded; at most `READY_TIMEOUT_MS`, 4 s, after the camera is placed).  At `REVEAL_AT` ms from then:
   - 0: the loading text fades out and **the physical scene** (the stars, the Milky Way, the Sun and planets) fades in from black over 600 ms.  The canvas is held at opacity 0 (0.001: [homepage](#homepage)) until then (`ThreeUi.holdCanvas`/`showCanvas`; without a hold, as in the guide's scenes, it shows with its first frame), but renders all along, so the exposure has adapted; the meter's own entrance, the Sun's flash as the stars come into its frame, plays as it shows.
   - 250: the orbits; 450: the asterisms, the grids and the expansion lines; 650: the labels (bodies', places', stars', galaxies'); 900: the chrome.  Each fades over 400 ms, so all is in 1.3 s after the scene is.
4. **Nothing a link hides is drawn**, at any frame: the link's settings are decided in the constructor, before anything is built (below), every overlay is held hidden until the reveal, and the reveal fades in only those whose settings are on.  The chrome starts hidden (`<html class="chrome-hidden">`) and the reveal shows it only if `v` is on.
5. **The readout is quiet.**  What the page starts in (a link's tracking, following, `ev=`, `sm=`; the following a path's arrival turns on) isn't announced: `Celestiary._announce` tells the readout's listeners only outside `_quietly`, which wraps a link's restore and the first load's arrival.  "Tracking on" is for the user's `t`.

**Why settings come first.**  The link's `s=` used to be applied in `_arrive`, after the stars had loaded (`applySettings` waited for them), by toggling: until then the scene drew with the defaults, so a link's hidden orbits, labels and asterisms showed and then went, and its `v` showed the chrome and then hid it.  Now `Scene.initSettings` sets them before `load()`; each overlay reads its group's state when it's built (`Scene.overlayShown`, `_joinOverlay`: a planet's orbit, name and places in `Scene.add`, the stars' labels, the asterisms, the galaxies' labels, the expansion lines, the temp marker), and the asterisms are built when the stars arrive if `a` is on.  `applySettings` no longer waits for the stars: a toggle sets its setting whether or not what it shows exists yet.

## Homepage

What the bare URL shows ([#241](https://github.com/celestiary/web/issues/241), in [#118](https://github.com/celestiary/web/issues/118)): the title, the search, four scene cards and a [What's new](#whats-new-and-the-changelog-tour) button over a slow tour of the live scene.  Any link or path goes straight to its scene, as before.

- **When.**  At the bare URL only: no fragment (or an empty `#`), and the site's root path (`home.js` `isHomepage`, against `document.baseURI`, so a preview's `/web/pr-preview/pr-N/` counts).  The query string doesn't count: `?perf=1` and `?hdr=0` still show it.  The bare URL used to load the Sun and rewrite itself to `#sun`; now it stays bare while the homepage shows, its history entry marked (`HOME_HISTORY_KEY` in `history.state`), and the address bar isn't written (`_schedulePermalinkUpdate` returns): the tour isn't a view.
- **The foreground** (`ui/Homepage.jsx`, `store/HomeSlice.js`'s `homePhase`: `waiting`, laid out unseen while the scene loads; `in`; `out`, fading; `hidden`).  It comes in with the first load's reveal: at `REVEAL_AT.loading` the page's loading title moves and grows into the homepage's (`loading.js` `handOffLoadingTitle`, a FLIP of the one element; with reduced motion, or no loading title, it fades in), and the search, the cards and the "Explore" button follow a beat apart (CSS delays, as `REVEAL_AT`).  The overlays and the chrome don't come in: the reveal's later steps wait until it's left.  A radial scrim behind it keeps the text legible over a bright frame.
  - **The search** is the app's `SearchBar` with `home`: always open, scoped to everything, no breadcrumb or picker, focused on a desktop (not a phone, where focus would raise the keyboard over the cards), no list until something is typed.  A pick, Go or Enter [flies there](#flights-from-the-homepage) from the tour's view (`Celestiary.goToResult`): a body to where `g` would arrive, facing it; a place to over it, then the app's landing; a star or a galaxy by the app's go.  Enter before the list has come up goes to the best match once the index is built.  Look at leaves the homepage first.  The nav's own search bar isn't mounted while the homepage is, so the two don't share the store's open state or `#search-bar`.
    - **Its index** is the app's (`search/SearchIndex.js`), asked for from the page's first frame, before the loader has the bodies and before the stars' and galaxies' catalogues register.  It was built then, nearly empty, and the first catalogue to register left it unready for good, so every query answered nothing.  Now anything that makes it stale (a provider registered, a body loaded: `markStale`) has the next query rebuild it, answering from the last build meanwhile, and the bar asks again when a build lands (`onChange`).  [js/search/DESIGN.md](js/search/DESIGN.md#tiered-index).
  - **The cards** (`home.js` `HOME_CARDS`): tonight's sky, Earth, the Moon hiding Jupiter ([#192](https://github.com/celestiary/web/issues/192)), Gaia's stars.  The last three are links, opened by `Celestiary.openLink`: a `pushState` of the link (its own history entry, so a reload, even mid-flight, opens the card's view), then `leaveHome({link})`, which applies the link's `s=` (held, as on a first load; the HUD stays on, for a visitor arriving from the homepage) and [flies there](#flights-from-the-homepage) from wherever the tour is, ending on the link's own restore.  The overlays the link shows and the chrome then fade in at `REVEAL_AT`.  No page load.  A card is an `<a href>` to the full link, so a middle click opens it in a tab.
  - **Tonight's sky** (`tonight.js`, `Celestiary.openTonight`) is the visitor's own sky from the ground.  Where: the browser's Geolocation, asked for only on the click (never on load), else a city for the browser's time zone (`TIME_ZONE_CITIES`, ~60 IANA zones, no network), else Greenwich.  When: now if the Sun is more than 18° down there; else this evening's astronomical dusk, when it next sinks past 18° (a 15-minute search over the next day, bisected to a second); where it never does (a summer far north), the next day's darkest moment.  The Sun's place is the app's own ephemeris, VSOP87C's Earth turned round (`Animation.vsopAt`), with Meeus's low-precision Sun before it loads (they agree to 0.02°).  The camera [flies there](#flights-from-the-homepage) and lands (`_landTonight`: `Scene.land`, instant, from where the flight left it) facing 50° up toward the equator, at 70°, the clock set and running at real time, the overlays and labels at the app's defaults; once there the readout says which location and time it used ("Tonight's sky from New York (your time zone), at dusk, 18:52"; `Celestiary.onNotice`).
  - **What's new** is a button beside "Explore the live scene": the changelog's latest entries, each flyable like a card, with a marker for what is new since the visitor's last visit, and a [changelog tour](#whats-new-and-the-changelog-tour) of the entries that have a view.
- **Leaving.**  `Esc`, the "Explore the live scene" button, or a pointerdown or wheel on the canvas (the foreground takes pointer events only on its controls, and none while it's unseen or fading out) leaves for the live scene: the tour stops where it is, in the frame of the body it's about (following it, as after a `g`), the foreground fades out, the overlays and the chrome come in at `REVEAL_AT`, and the view is written as a new history entry.  The search leaves too.  Any first link write after leaving pushes rather than replaces (`_writeLink`: the current entry is the homepage's), so whatever leaves it, Back comes back.  A `hashchange` while it shows (Forward, the search's Go to a body) leaves it for that link.
- **Back** to the homepage's entry (`popstate` with the mark, at the bare URL) shows it again (`showHome`): the overlays and the chrome fade out, the canvas to black, and the tour starts over.  Both there and on the first load it shows only once the tour has drawn `HOME_SETTLE_FRAMES` frames, the meter has taken `HOME_SETTLE_READINGS` readings since the tour placed the camera (`ThreeUi.meterReadings`), and the exposure is within a stop of the meter's goal (`ThreeUi.exposureSettled`); at most `HOME_READY_TIMEOUT_MS`, 8 s.  So the meter has stopped down for the Sun, rather than show the Sun's glare at the open exposure of the view before (a starfield, the Moon at night: a white screen).  A hidden canvas is at opacity 0.001, not 0 (`HIDDEN_CANVAS_OPACITY`), so a compositor doesn't take it as undrawn while the meter's fenced reads wait on it.  In the sandbox's SwiftShader a reading can take seconds, so there the 8 s cap is what shows it.
- **Cost.**  While it shows, the Cesium layers are suspended (`CesiumLayers.suspended`: celestiary's own Earth draws and nothing of Cesium loads; CESIUM.md) and the frame rate is capped at 30 (`ThreeUi.setFrameCap`: an early frame is skipped).  With the overlays held there are fewer draws (16 a frame at the tour's start against 28 for the same view after leaving, `?perf=1` in the sandbox).  The cap's effect needs a real GPU to measure: SwiftShader draws a frame or two a second.

### Flights from the homepage

A card, tonight's sky and the search's Go fly from wherever the tour is to their view (`flight.js` `FlightPath`, played by `Celestiary._flyTo`/`_frameFlight`), rather than cutting to it.

- **The foreground fades out first.**  A click on a card, a Go, or What's new's Fly there leaves the homepage at once (the tour stops where it is, the foreground starts its 400 ms fade), but the scene doesn't change until the foreground is out of the page, `HOME_FLIGHT_HOLD_MS` (600 ms, `HOME_UNMOUNT_MS`) after the first frame (`_holdFlight`): no load of the link's frame, no target, no go, no date, no scene settings (a link's `s=`, tonight's defaults: the Milky Way's switch shows at once), no Cesium layers (`_homeCost` lifts the homepage's suspension then).  Only a flight whose date needs the dark (`timePlan`'s `dip`, below: near a body in the view the whole way, decided at the click from the link's `t=` or tonight's date, the view then and the path laid out in the world, `_needsDark`, `_linkDest`) takes the scene to black with the foreground, in the same 400 ms (`_holdFlight({dark})`, `HOME_FADE_MS`); the date is set in that dark and the scene fades up as the flight starts, with no dip of its own (`_launchDark`).  The first cut held the dip back until after the fade, so the foreground went, the scene showed a moment, blinked to black and came back, then the flight (the maintainer saw it on the preview); the second folded every dip into the fade; now most long changes are set mid-flight, unseen, with no dark at all.  What leaving asks for waits in the hold (`_deferFlight`: `_flyToLink`, `_flyTo`, a go such as the search's Go to a star or a path-only link), the last asked for winning, so a second card in the fade (a keyboard's) replaces the first.  The hold's marker in `Shared.targets.tween` is a travel's, as a flight's is (following waits, the link isn't written): something else taking the camera in the fade (a link restored, a key's go) ends it, `Esc` or a click on the scene stops it with nothing moved (`stopFlight`: the live scene, the chrome in, the tour's view written), Back drops it (`_cancelFlight`).  The maintainer's review: with the flight, its dip and the layers starting under the fade, it was too fast to see what was happening.  Before the scene is in, or where the foreground isn't on screen (the changelog tour's link), there is nothing to wait for.  The first load's reveal no longer brings the overlays in once the homepage has been left after it began (`_revealOverlays`): a card clicked in the reveal's first 900 ms had them fading in under the fade.
- **The frame.**  It starts as the app's go does (`Scene.goTo`, its tween dropped, as the tour's driver does): the world rebased and the camera hung on the view's body's orbit, where it was.  So the whole flight is in that body's frame, the body still under it, and the view's own pose is computed there each frame (`_flightEnd`): a link's `@lat,lng,alt` and `cq` as `_restoreView` would put them (on the turning body, landed), tonight's place on the ground, where `g` would arrive.
- **The path** (`FlightPath.pose`): about the body's centre, the log of the altitude eased from the start's to the end's, so a flight in from 3,200 light-years, or down to 169 m, is as smooth at every scale; the direction from the centre slerped, done by the middle of the way on a long descent so the end isn't a skim over the ground.  Three overlapping turns: to face the body (the first 30%), facing it in, then to the view's own orientation (the last 40%), with the field eased geometrically over that last turn (the occultation's 0.91°).  2.4 to 6.5 s, by the decades of altitude and the turn covered (`flightDuration`).
- **The ease-in** (`flightProgress`): over its first `FLIGHT_EASE_IN_MS` (1.5 s) the path's clock runs slow, its pace coming up from standing to the path's own as a smoothstep (no step in speed or acceleration), then runs at it, so the fast travel and the settle are the path's as before, begun later; it covers the path's first 0.75 s, so a flight is 0.75 s longer (`flightTotalMs`).  The path's own sine ease starts at rest too, but in log altitude it was quick: in from the Sun's view to Earth (4.4 decades, a 3.8 s path) the distance was 10% down 0.26 s in and 32% at 0.5 s; eased in, 0.1% at 0.4 s, 5% at 0.8 s and 60% (0.4 of the 4.4 decades) at 1.5 s, the other 4 decades in the next 2.3 s and the settle (headless, PR [#268](https://github.com/celestiary/web/pull/268)).  It applies to every flight (`_frameFlight`): the changelog tour's, and a card's from mid-flight, start from rest too.  It steps on the frame clock; its marker in `Shared.targets.tween` (`flightTween`) is the app's sign of a travel, so following waits, the link isn't written, and the exposure follows the body in (`ThreeUi.approach`, for a view within 100 radii, not landed).
- **It ends on the view's own arrival**: a link's restore (`_arrive`, the same as a reload of it: time, view, target, tracking, following, `ev=`, `sm=`, the clock), tonight's landing, a place's landing, a body targeted.  The flight's last frame is already there, so the restore moves nothing on screen; `ThreeUi.settleArrival` first hands the meter the arrival's gain: the approach's, as the end of a go's tween does, or, for a landing or the far stars, what its last readings asked for (by the flight's last turn they are of the view itself).  Without it the meter went on from the tour's gain: flown in from the Sun's view, stopped down for its disc, the occultation came up from 17 stops dark over several seconds.  Then the overlays the view shows fade in and the chrome follows, at `REVEAL_AT` (`_afterFlight`), and the link is written.
- **The date** (a card's `t=`, tonight's) changes as `timePlan` says, so nothing visibly jumps:
  - nothing near the camera in the view (no body within `NEAR_RADII`, 300 of its radii, under half a degree, inside the field's cone to its corners, widened by the body's angular radius: `_nearestShownRadii`): at the start, at once.  The tour out among the planets and the stars, or turning between them.  A near body out of the view changes nothing on screen (the camera rides its frame, the others move by a pixel or so), so it doesn't count; before, any body within 300 radii did.
  - near a body in the view and at most `EASE_TIME_MAX_MS` (2 days) to go: eased along the way with the travel, a time-lapse (Earth turns at most twice, the Moon moves on).  The bodies are put at each frame's date before the camera is placed against them (`_setSimTime`).
  - near a body in the view and longer (`unseen`): at once, mid-flight, on the first frame where it shows nothing (`_dateUnseen`, `_jumpCheck`): no body near in the view, before the change or after it, and nothing in the view moving across it by more than the view itself turns in that frame (or 0.05°, `JUMP_SHIFT_MAX_DEG`, if it turns less).  Typically early, as the camera turns from the start's body to face the end's, which is still small: the Earth card from the tour by the Sun sets its 7 days at a tenth of the way, 1.2 s in, with Pluto the only body in the view (headless).  Changing it at the start there would turn Earth's day side under the camera, or move the Sun 1° a day across the sky of a camera riding Earth's orbit; easing a month through the flight would spin Earth thirty times.
    - **The frame.**  The camera rides the end body's frame (its `orbitPosition`, or the body, landed) from the start, so the change moves it with the body along the body's orbit: about the body the camera doesn't move; against everything else it moves as far as the body does (Earth, a week: 1.8e10 m).  That is why the check is on the whole view: the start's body behind, the planets' points far enough (a planet 1e12 m off moves 1° for that), and the end's moons (the Moon beside Earth moves by a week of its orbit, half a degree from an AU out) all have to pass; the stars, at infinity, don't move.  Mercury beside the Sun, or the Moon beside Earth, holds it back while in view.  The 0.05° floor is a pixel or two; the turn allowance is that a point's step smaller than the whole field's sweep in that frame doesn't show (headless frames are slow, so they allow more than a display's).
    - **The path.**  The end, about the body, turns with it (a link's view is on the turning body), so the path to it would jump; it's re-anchored (`FlightPath.reanchor`): from there the pose is the path to the new end, turned about the centre, scaled and rotated by what takes it to where the old one was, a correction blended out (smoothstep) by the end.  The camera, placed that frame before the change, doesn't move; no frame after steps more than its neighbours; the arrival is exactly the link's view at its date (`Celestiary.test.js`; `flight.test.js` for a 14° jump of the end).
    - **The prediction** (`_unseenAhead`): the plan is `unseen` only if the flight has such a frame, the path laid out in the world before the flight, tried at a hundred points against the bodies at both dates (`_bodyPlacesAt`: the scene set to the view's date and straight back, the clock untouched), with a 60 fps frame's turn.  A frame that fails live is put back as it was and the next tried; past `UNSEEN_LATE_U` (85%) it's set anyway, which only a missed prediction reaches.  Before the change the clock runs on; after it, it's held at the view's date.
  - near a body in the view the whole way (`dip`): in the dark, then the flight as the scene fades back in: from the homepage, the dark the scene went to with the foreground (above); a flight from elsewhere (the changelog tour's next stop, a card mid-flight), a short dip to black (300 ms) of its own.  On the homepage (the link cards are 7 to 14 days old on 2026-10-20; surveyed at 2 s steps of the tour, in the unit tests' scene): Gaia never dips; the Earth card dips only from over Earth's day side (the tour's 28-40 s, 10% of the loop); the occultation, which lands on Earth, from anywhere near Earth (24-80 s, 43%), Earth near and in view the whole way.  Of What's new's views, those on or near Earth dip from Earth's segment of the tour the same way, Mars's and Saturn's also from by the Sun, which stays in view on the way out to them.  The rest set the date at the start (the tour turning, 18-22 s, and out among the planets and stars, 82-132 s) or unseen.  Tonight's sky is under a day (eased), a search's Go has no date.
- **Interrupted.**  `Esc`, or a click, drag or wheel on the scene, stops a flight where it is (`stopFlight`): the live scene from there, the overlays and chrome in, its link written in place of the card's.  Another card mid-flight (a keyboard's; the cards take no pointer while they fade) flies on to it from where the camera is, in the first card's place in the history.  Back to the homepage drops it (`_cancelFlight`) and the tour starts over.  Anything else that takes the camera (a link restored, a key's go) ends it where it is.
- **Before the scene is in** (the homepage left before its reveal) there is nothing to fly from: it goes straight there, and the first load's reveal shows it.  A link whose frame is a star's (`from=hip:N`) cuts to it under black (`_cutTo`).

### What's new and the changelog tour

[#246](https://github.com/celestiary/web/issues/246), in [#244](https://github.com/celestiary/web/issues/244): the project's user-facing changelog (`CHANGELOG.md`, built into `public/data/changelog.json` by `yarn changelog`; [tools/changelog/README.md](tools/changelog/README.md)) on the homepage, and a guided tour of it.  The social campaign's reel ([#247](https://github.com/celestiary/web/issues/247)) is that tour screen-recorded.

- **The data** (`changelog.js`): `loadChangelog` fetches `data/changelog.json`, a plain relative URL, because it is small data under `public/data/` ([data policy](#data-policy)), and `parseChangelog` checks and normalises it (an entry without a headline or a `YYYY-MM-DD` date is dropped, a link that isn't http(s) is dropped, newest first, a day's entries in file order).  `Celestiary.loadNews` asks once and caches (a failure is asked for again next time).  It is asked for when the panel opens, or the tour starts, not with the page ([#258](https://github.com/celestiary/web/issues/258)): the button and its marker are from the changelog's dates alone, `js/changelogStamp.json` (`[date, entries that day]`, newest first, about 500 bytes), which `yarn changelog` writes with the JSON and the app's bundle carries (`stampEntries`).  The panel shows once the entries are in; a failure to fetch them then closes it and takes the button away, as a failure on load used to (a tour link falls back to the homepage).  An entry's `permalink` is the fragment without its `#`, as a card's link is.
- **The panel** (`ui/WhatsNew.jsx`, opened from `ui/Homepage.jsx`): a sheet over the homepage with the latest 8 entries (16 more at each "Show earlier"): date, headline, text (backticked spans as code), the PR and issue links, and an image where the entry has one.  An entry with a permalink has **Fly there**, an `<a href>` to its link (a middle click opens a tab) whose click is `Celestiary.openLink`: the same flight as a card, the homepage fading out as for one, ending on the link's own restore (so the camera is exactly the permalink's view), its own history entry.  An entry without one is for reading.  `Esc` closes the panel before it leaves the homepage (a capture listener).
- **Featured, kind and the filter** (`changelog.js` `visibleEntries`, `toggleFilter`, `readFilter`, `writeFilter`; `ui/WhatsNew.jsx`): an entry marked `- Featured: yes` in CHANGELOG.md has `featured: true` in the JSON, and one marked `- Kind: fix` has `kind: 'fix'` (a feature, the default, has no `kind` in the JSON; the app's `parseChangelog` reads it as `'feature'`; the build refuses any other value).  The two are independent, since a major fix can be featured.  The panel has a filter bar of three buttons with `aria-pressed`, styled as the drawer's chips (`.news-chip`): **Featured only**, and a joined pair, **Features | Fixes**, each on or off, with the count ("12 updates") and a heading in step ("Featured updates", "All fixes", ...).  All three are on by default.  The list is the entries that pass every active filter: featured if Featured only is on, and of a kind that is selected (`visibleEntries(entries, filter)`).  **Never both kinds off:** pressing the one kind left on selects the other instead of turning itself off (`toggleFilter`, like a radio), because an empty selection would be a list that shows nothing and says nothing; so from both on, pressing Features gives Fixes only, pressing Fixes then (the last one) swaps to Features only, and pressing the unselected one turns both on; it never goes to none.  (A stored filter with neither kind is normalised to both on, `normalizeFilter`.)  What isn't there to filter stays out of the way: no bar where nothing is featured and every entry is of one kind, and a changelog with no featured entry isn't narrowed by Featured only, so a file without the tags lists everything.  An entry is tagged **Featured** (when Featured only is off, since otherwise they all are) and **Fix**.  A filter that matches nothing says so under the bar ("No updates match. Turn a filter off."), and the buttons stay.  The choice, all three, is `localStorage` `celestiary.whatsNew.filter` (JSON `{featuredOnly, features, fixes}`), every access in try/catch, so with storage that throws it is always the default.  The first version's key, `celestiary.whatsNew.showAll` (`1` was "all updates"), is read as Featured only off when there is no new key, and removed the first time the new one is written.  The "N new" marker is not the filter's: it counts the featured entries whatever the buttons say.  The changelog tour follows the filter: `tourStops(..., {filter})`, `startNewsTour({filter})`, from the panel's own state (so it holds when storage fails) and the stored choice for the tour's link.
- **Links to the live posts** (`socialLinks.mjs`, the icons in `ui/NewsIcons.jsx`): an entry with `social: {x, facebook}` in the JSON, once its social post is live, shows a small X and Facebook mark beside its PR and issue links, each a link in a new tab (`rel="noopener"`, `aria-label` "on X" and "on Facebook"), inline monochrome SVG in the links' grey like the panel's other icons.  The URLs are recorded once, by the maintainer, in the post's block in `posts/drafts.md`, and `yarn changelog` joins them (tools/posts/README.md "Links to the live posts"); both the build and the app accept only https URLs on x.com or twitter.com (X) and facebook.com (Facebook), the app dropping any other rather than linking it.
- **"New since your last visit"** (`changelog.js` `checkNew`, `markSeen`, on the stamp's dates, counted by `unseenCount` on the stamp's featured dates, so it counts what What's new opens on and not the lesser updates; `freshIds` tags the entries once they're in): the newest entry date the visitor has seen is in `localStorage` (`celestiary.whatsNew.lastSeen`), and the button carries "N new" for the entries dated after it.  The first visit (nothing stored) is a baseline: nothing is new, and the newest date is stored, so a first-time visitor isn't told about 70 entries.  Opening the panel stores the newest date and clears the marker; the entries that were new keep their **New** tag until it closes.  The grain is a day: an entry on the day last seen isn't new.  Every access is in try/catch (the `localStorage` accessor itself throws in a private window or with site data blocked): with storage that throws nothing is ever new, and nothing else changes.
- **Quiet loads.**  What's new exists only where the homepage does, which is the bare URL (and the tour's own link, below), so a permalink with the HUD off never mounts it, never fetches the changelog (nor does the homepage, until the panel opens) and never touches storage (`js/Celestiary.test.js`, "shows nothing on a link with the HUD off").  The tour's link `#;news:tour;s=v` is not a tour either (`decodeNewsToken`).  The page's own quiet-load rule for the loading text is unchanged ([the first load](#the-first-load)).
- **The changelog tour** (`newsTour.js` `NewsTour`, driven by `Celestiary.startNewsTour`): the entries that have a permalink and are shown (`tourStops`; entries without a view are never stops, and shown by the filter), newest first, or from a chosen entry or date toward the older ones, at most `n`.  For each stop: **fly** to its scene (`_newsGo`: from the homepage `leaveHome({link})`, else `_flyToLink`, the cards' flight with its [time plan](#flights-from-the-homepage), so a date far from the last is set under a dip to black, a near one eased), **caption** once the camera has arrived (its own restore has run, no flight or cut pending: `_newsArrived`), **hold**, then fly on.  A path-only permalink (`#galaxy:ngc2403`) goes by the app's go and counts as arrived when its tween ends; a stop that never arrives is skipped after 20 s.  At the end, or on `Esc`, the tour stops where it is: the live scene, the chrome in, the link written as a new entry after the homepage's, so Back returns to the homepage.
  - **Caption** (`tourCaption`): the headline and the first sentence of the text, with the next if the first is short, cut at a word at 220 characters, backticks dropped.  Held `holdMs`: 3 s and 45 ms a character, 6 to 14 s.  The date shows above the headline.
  - **Made to be recorded.**  Nothing else is on screen: the homepage's foreground fades out as for a card, the chrome stays hidden through the tour (`_overlaySteps` skips its step while `_news` is set; the overlays a permalink's own `s=` shows do come in, they are part of its view), the address bar isn't written (the tour isn't a view: `_schedulePermalinkUpdate`), the caption is large on a bottom scrim with a text shadow (`ui/NewsTour.jsx`), and the controls (previous, pause, next, stop, "3 / 12") fade out when the pointer rests and wake when it moves; on a touch screen (`hover: none`) they stay, small.  The app's keys are held back while it plays (`_onNewsKey`, a capture listener): `Space` pauses, the arrows skip, `Esc` stops; Tab, function keys and browser shortcuts are left alone, and so is a focused control's own Enter and Space.
  - **Controls.**  Pause holds the caption's clock, and a flight under way (`_frameFlight` slides its clock by the frames held, so it resumes where it was).  Next and previous skip from a flight or a hold (a new flight from where the camera is; skipping while paused carries on), previous at the first begins it again, next at the last ends it.  A click, drag or wheel on the scene ends the tour, as it leaves the homepage; on a touch screen, a tap on the scene does too.  Back to the homepage (`showHome`) or another link (`hashchange`) takes the scene from it (`_abandonNewsTour`).
  - **Reduced motion**: no flights; each stop is a cut under black (`_cutTo`, 300 ms down, then up), and the caption and controls don't fade.
  - **The link** starts it: `#;news:tour[,from=<id or date>][,n=<stops>]`, a fragment with no path and no view ([design/URLs.md](design/URLs.md#the-news-token)).  It is the homepage's (`isHomepage` accepts it) but its foreground never shows: the first load's reveal hides the loading title, the homepage's tour starts under the scene's fade-in, and `startNewsTour` takes it from there, so a recording begins on the flight out of the Sun's view.  Without a changelog to play it falls back to the homepage.
  - **Tested** (`changelog.test.js`, `newsTour.test.js`, `ui/WhatsNew.test.jsx`, and `Celestiary.test.js` "the changelog tour"): parsing the real file, the marker with storage that throws, the stops (order, skipping entries without a view, from an id or a date, a count), captions and hold lengths, the sequencing on a fake camera (order, next, previous, pause, stop, a stop that never arrives), and in the app: three stops flown to in order, each ending on its permalink's view with the chrome hidden and nothing written, then the live scene with the link pushed; the controls and keys, a click on the scene, reduced motion, Back, the link and its `from=`/`n=`, a failed fetch, and a HUD-off link fetching and storing nothing.
- **Phones**: the button and the Explore link wrap on one row (the cards stack as before); the panel is a sheet with a 16px gutter and its own scroll, and the caption's text is clamped to the width less 32px, `overflow-wrap: anywhere`, above the controls and the safe-area inset; on a short screen (a phone on its side) the sentence goes and the headline stays.

### The tour

A camera path (`tour.js`, `CameraPath`), played by `tourDriver.js` (`TourDriver`); the homepage's is `homeTour.js`.  Reusable for guided tours: a path is keyframes, the driver puts the camera there through the app's own camera API.

- **Keyframes**: `{at, body, dist, az, el, fov, look?, days?, ease?, turn?}`: ms from the start; the body the camera is about (its frame, and the target); distance from its centre; azimuth about the ecliptic's north from the body's sunward direction (the Sun's: toward Earth), so 0 is over the day side and 90 over the dusk terminator on any date; elevation over the ecliptic; the field; the body faced, if another; the date, days after the start; the segment's easing (`inOut`, a sine's, by default); the share of the segment over which the camera turns from the last keyframe's look.
- **Interpolation.**  About one body: azimuth, elevation and the log of the distance, eased, so a sweep past 180° is a sweep and a pull back from 2e7 m to 3e19 m is as smooth at every scale; the field geometrically.  Between two bodies the start is re-expressed about the second (where it is this frame) and interpolated the same way, so a travel from the Sun closes in on Earth geometrically, Earth growing steadily.  The look is a slerp between facing one body and the next, over `turn` of the segment.  Its up is the ecliptic's north, as `c` squares it.
- **The driver.**  Each frame, from Celestiary's animation callback after the bodies have moved: the camera's world pose into the platform's frame.  When the path's body changes, `setTarget` and `goTo` hang the platform on the new body's orbit, keeping the camera's world pose, and the go's tween is dropped (as a link restore does); so the target's surface preloads as the camera heads there, and stopping leaves the camera in the live scene as a `g` would.  Its clock is the frame clock, each step held to 100 ms and none while the page is hidden, so a hidden tab pauses it and coming back carries on.  A still (`prefers-reduced-motion`) holds one time.  A loop fades the canvas to black over its last 1.2 s and back over its first.
- **The homepage's tour** (about 2 min 20 s, looping): by the Sun (4.5 to 4 solar radii, 0-14 s); on to Earth, turning to it over the first 45% and closing in to arrive over the evening's crescent (14-32 s); over the terminator into Earth's shadow, the crescent thinning and the Sun setting behind the limb (32-50 s); held in the shadow, creeping in, while the exposure adapts and the night side's city lights come up, the sunlit air a ring round the limb (50-64 s); pulling back toward the day side to the Moon's distance, the Sun rising over the limb (64-78 s); out through the planets' orbits to 40 AU, turning to the Sun (78-96 s); out to 12 light-years (96-114 s) and on to 3,200, among Gaia's stars with the Milky Way around them (114-132 s); a moment there, and round again.  The still is in the shadow (58 s).  The exposure meters as it goes: the Sun's disc, the dark-adapted starfield as the camera turns away, Earth's crescent, then its night side.
- **Live, planned against the Sun** (`nightSide.js` `planEarthPass`, `homeTour.js` `homeTourKeyframes`).  The tour runs at the visitor's own time, so the Earth segment is planned when it starts (`Celestiary._startTour`, from `Time.simTime` and the app's ephemeris, `_sunAt`), and again each time round (`TourDriver.start`'s `replan`, at the loop, under its fade): the same picture every visit, only the place under it changing with the hour.  A plan takes about 15 ms; it asks the ephemeris for the Sun once (`tourFrame`), not once an aim: VSOP87C is about 2 ms a call, and asked once for each of ~2,000 aims a plan took 4 s (behind PR #249's CI timeouts: the homepage's tests, run where Celestiary.test.js's mock of `./vsop` didn't hold, took over 5 s).
  - **Which night side.**  Aims 2.5° apart, 45° S to 60° N, dark (the Sun 12° down there: `DARK_FULL_DEG`), each scoring the city light within 15° of it, each 5° cell's by its own darkness (from twilight at −6° to whole at −12°), so a summer's short northern nights count for less and a polar day for nothing.  City light is the Earth material's own night-lights texture summed per cell (`scene/nightLights.json`, built by `tools/home/nightLights.py`; [Planet.md, city light per cell](js/scene/Planet.md#city-light-per-cell)), not a list of cities.  Of the aims from 21:00 to 01:30 local (solar) time the brightest wins, 15% less for each hour outside 22:30-00:30, if it has a quarter (`MIN_SHARE`) of the brightest night side's light (the eastern United States', India's, Europe's).  Else (midnight over the Pacific: about 15% of the hours over a year) the aim nearest midnight that has, 19:00 to 03:30: the nearest lit coast, East Asia's early evening or the American west after midnight.  An aim counts only if the shadow's camera sees it within `AIM_MAX_DEG` (45°) of its ground point.  In a northern summer the antisolar point is at 23° S, so the north's cities are toward the limb (40-45° off) or, near the solstice, give way to São Paulo or the south.
  - **The camera's path** (`passGeometry`), in the tour's frame, where the terminator is always the meridians at ±90° and the antisolar point is azimuth 180°, elevation 0, whatever the season.  It arrives over the crescent (azimuth 100°, 3.4 Earth radii), then into the shadow: 3 Earth radii out (`ECLIPSE_DIST`; the globe 39° across, so it and its ring fit a 42° field), its ground point on the arc from the antisolar point toward the aim, as far as keeps the Sun 6° behind the limb (`SUN_MARGIN_DEG`, `eclipseReachDeg`: 13.5°).  The hold creeps in to 2.76 radii (`HOLD_DIST_SCALE`), the Sun further behind.  The Sun's glare goes with its visible fraction (Sun.md), so none shows there.  Tests (`nightSide.test.js`) check, at eight times a day on each solstice and equinox, that the aim is dark, within the hours and lit; that the arrival has the terminator, the crescent and the night side in a 16:9, 16:10 and 4:3 frame; and that through the shadow and the hold the Sun is at least 6° behind the limb, nothing sunlit faces the camera, and the aim is in frame.
  - **Pinning the time** (screenshots, probes): `c.time.setTime(ms)`, then `c._startTour()`; the plan is `c.tour.path.plan`.  The cards' images aren't the tour's (tools/home/cards.mjs renders their links, which carry their dates).
  - **The exposure is the meter's**, nothing boosted.  Beside the sunlit crescent the gain is 1 (the sunlit body anchors it; [HDR.md, metered exposure](js/scene/HDR.md#metered-exposure)), and at that gain the city lights, 3e-5 of a sunlit white, are black, as a camera at the terminator sees them (PR #249's first cut, which held the crescent in frame, measured at most 8 of 255 from the lights).  In the shadow nothing sunlit is in the frame, the meter dark-adapts, and the lights come up: headless (SwiftShader, 480 × 300, no ion), on 2026-10-13 at 23:00, 18:30, 15:30, 14:30, 05:30 and 10:00 UTC (Europe, India twice, East Asia, the eastern United States, and the Pacific's fallback, the American southwest), the held view settles at a gain of 1.0e5 to 1.7e5, the lights add up to 231-240 of 255 over the same frame rendered with a black night map, and the Sun's visible fraction is 0 from the shadow on (it sets behind the limb at about 44.6 s), so no glare; the corona shows beyond the limb, and the sunlit air as a ring.  The meter's gain eases up with a 1.5 s time constant, reading every fourth frame, so from the crescent's 1 to the shadow's 1e5 (17 stops) it is within a stop in about 4 s and a quarter of one in 6 s of real time; the 14 s hold leaves it over 8 s at the adapted gain.  Measured headless, the tour played on the wall clock from the arrival at 3 to 5 frames a second (a reading every second or so): the gain was within a stop of its settled value 6-10 s after the Sun set behind the limb, at 49-56 s of the tour, and within a quarter stop by 52-58 s (one run, India at 18:30, by 63 s), so even there the lights are up for the last 9 s of the hold.  On a real GPU the meter reads every 133 ms and should be faster; that needs checking on one.  The land's lavender at that gain is the Black Marble picture's own floor (moonlit snow and desert, airglow, lifted into blue: [Planet.md](js/scene/Planet.md#brightness-what-the-textures-values-are)), which the surface shader adds with the lights; taking the floor out there, as `nightLights.py` does for the table, is a follow-up.

## Core Class Hierarchy

```
Celestiary            Main controller (window.c for debug)
  ├── Time            Simulation clock (timeScale, pause, Julian Day)
  ├── Animation       Per-frame orbit/rotation updater (VSOP87 + elliptical)
  ├── ThreeUi         Three.js wrapper (renderer, camera, controls, render loop)
  │     └── Scene (three.js)
  ├── Scene           Celestiary scene manager (object registry, targeting, picking)
  │     ├── Stars     Star field (buffer geometry, shader, labels, asterisms)
  │     ├── Star      Individual named star (LOD, Perlin noise surface shader, PointLight)
  │     ├── Planet    Planet or moon (LOD, orbit shape, surface mesh, atmosphere, labels)
  │     └── Galaxy    Invisible grouping root (Milky Way container)
  ├── ARController    Mobile sky view: device sensors → camera orientation
  ├── Loader          Async JSON fetcher for celestial object descriptors
  ├── ControlPanel    DOM-based nav display (breadcrumb path)
  └── Keys            Keyboard shortcut registry
```

All scene objects inherit from `js/scene/object.js` (a thin Three.js `Object3D` wrapper).

## Coordinate System & Scale

Distances are stored in **real SI meters**. Key constants from `js/shared.js`:

- `ASTRO_UNIT_METER = 149597870700` m (1 AU)
- `SUN_RADIUS_METER = 6.957e8` m
- `STARS_RADIUS_METER = LIGHTYEAR_METER * 1e4` m
- `SMALLEST_SIZE_METER = 6e5` m (allows zooming into Deimos)
- Camera near/far are set to `SMALLEST_SIZE_METER` … `STARS_RADIUS_METER * 2`

Three.js scene units equal meters. Planets use VSOP87 coordinates scaled by `ASTRO_UNIT_METER`; stars use Celestia binary catalog coordinates scaled by `LIGHTYEAR_METER`.

All celestial bodies (sun, planets, stars, asterisms) live under a single `WorldGroup` `Object3D`; the J2000 catalogues (stars, asterisms, star labels, Milky Way) sit one level further down, in the `StellarFrame`, which precesses them to the date (see [Frames and time](#frames-and-time)). Shifting `worldGroup.position` rebases the entire universe in one operation — used by star navigation to bring the current target star to world origin, so camera world coordinates stay small for float32 precision even across light-year distances. See [Navigation (goTo flow)](#navigation-goto-flow).

## Data Loading

`Loader` loads the body descriptors recursively along a path (e.g. `sun/earth/moon`), each body's `system` after it. Each JSON descriptor includes:

- `type`: `galaxy | stars | star | planet | moon | spacecraft` (a spacecraft: a glTF model on a trajectory table, [models.md](js/scene/models.md#a-spacecrafts-descriptor))
- `radius`, `orbit`, `axialInclination`, `siderealRotationPeriod`
- `system`: array of child names to load next
- Optional: `texture_*`, `has_locations`

Loading is cached per name; the URL hash (e.g. `#sun/earth`) drives the target path. `hashchange` events trigger re-loads.

**One file for the bodies** ([#258](https://github.com/celestiary/web/issues/258)).  The descriptors are edited one to a file, `public/data/<name>.json`; `yarn bodies` (`tools/bodies/build.mjs`) builds every one under the Milky Way (31, following each `system`) into `public/data/bodies.json`, a body to a line (31 KB, 6 KB gzipped), committed like the repo's other built data, and `tools/bodies/bodies.test.js` fails when it has drifted from them.  `bodyBundle.js` fetches it once for the page (every Loader, and every concurrent ask, shares the request), and `Loader.loadObj` takes a body from it, a copy for each Loader; a body it doesn't have (the guide's demo descriptors, `earth-as-moon`) is fetched from its own file, and so is every body if the bundle fails (one warning).  The first load asked for 31 files one by one, each answered before its children were asked for.  The order the scene gets the bodies in is now the walk's, not the network's; the scene graph is the same.

Stars are loaded separately from the Celestia binary star catalog (`StarsCatalog`), not from JSON: as its brightness tiers on the point-population engine ([below](#the-star-catalogues-tiers)), `stars.dat` whole as their fallback.

### What loads when

What the first load fetches is the page, its scripts, the bodies' bundle, the stars' bright tier and names (the catalogue's manifest, `packs/roots.bin`, `starnames.dat`: [the star catalogue's tiers](#the-star-catalogues-tiers)) and what the view shows ([#256](https://github.com/celestiary/web/issues/256)).  The rest waits until something needs it ([#258](https://github.com/celestiary/web/issues/258)); each is fetched once for the page (concurrent asks share the request), a failure is logged and asked for again by the next need, and nothing a user sees waits on it except as noted.

| Data | Fetched when | Code |
|---|---|---|
| A body's places, `data/places/<body>.json` (24 bodies, 664 KB) | The camera approaches the body with the `p` labels on (its disc a fifth of the screen's height, about 12 radii at the default field: ahead of tier 0's three quarters, so a go there, arriving at 10, asks as it arrives); a link to a place on it, or a place targeted or flown to | `Places.ensureLoaded` (its LOD hook, `LOAD_FRAC`; after a failure the hook waits `LOAD_RETRY_MS`), `Places.js` `loadPlaces` (shared by the labels, the link and the search's fallback) |
| The places' index for the search, `data/places-index.json` (259 KB, 113 KB gzipped: every place's name, position, kind and altitude, without the tiers) | The first search with text in it | `search/placesIndex.js`, `PlacesProvider`; [js/search/DESIGN.md](js/search/DESIGN.md#places-in-the-index) |
| SPARC's galaxies, `data/sparc/galaxies.json` (216 KB) | A view that could show one (the limiting magnitude reaching the brightest's 7.53 from the Solar System, or within a magnitude of it while the `G` labels are shown; or the camera 10,000 light-years from the Sun); a link to a galaxy; the first search; the `e` key | `Galaxies.ensureLoaded`, `galaxiesInView`, `Scene.loadGalaxies`; [Galaxies.md](js/scene/Galaxies.md#the-data) |
| Earth's satellites, `data/satellites.json`, and their chunk (satellite.js's SGP4, 20 KB) | The camera within 1.5e9 m of Earth with the orbits (`o`) shown; a `sat:` link; the first search | `Scene.loadSatellites`, `_watchForSatellites`; [Satellites.md](js/scene/satellites/Satellites.md#what-loads-when) |
| The changelog, `data/changelog.json` (73 KB) | What's new opens, or the changelog tour starts; the button's "N new" is from the dates alone, `js/changelogStamp.json`, in the bundle | `Celestiary.loadNews`, `changelog.js` `stampEntries`; [what's new](#whats-new-and-the-changelog-tour) |
| A spacecraft's trajectory table, `data/trajectories/<name>.json` (Webb's 99 KB, 43 KB gzipped) | With the ephemeris (the reveal, or the safety net after the first frame), or when the craft is targeted; the craft is hidden until it's in | `Animation.placeOnTrajectory`, `Spacecraft.loadTrajectory`; [models.md, positions](js/scene/models.md#positions) |
| A spacecraft's model, `large/models/<name>/<name>.glb` (JWST's 2.38 MB), and `GLTFLoader` and the meshopt decoder (dynamic chunks) | The model's LOD first draws its near level (the craft over a couple of pixels), or the craft is targeted | `Spacecraft` `buildNear`, `model.js` `loadModel`; [models.md](js/scene/models.md#the-loader) |
| The star catalogue's faint tiers, `large/stars/v1/packs/0.bin`-`11.bin` (97,867 stars, 1.65 MB gzipped, 12 requests) | The reveal (beside the ephemeris); before it, the packs a view wants to its limit plus a magnitude (a dark-adapted, deep or telescope link's field); a link or frame to a star not in yet, the first search, the human expansion; 3 s after the stars are drawn where nothing reveals the scene | `Stars.revealed` (which fades them in), `Stars.streamRest`, `Stars.whenStar`, `Stars.whenComplete`; [the star catalogue's tiers](#the-star-catalogues-tiers) |

On the homepage that is the bodies' bundle where there were 31 descriptors, 24 place catalogues, the galaxies and the changelog: 57 requests and 1 MB of JSON before.  The homepage's tour doesn't fetch Earth's places as it passes (its overlays are held, so no labels could show) nor the galaxies (at the night side's deepest, 6.66, the brightest's point is under the limit and the labels are held).  Measured in the PR ([#258](https://github.com/celestiary/web/issues/258)).

Large files (textures, `stars.dat`, anything under `public/large/`) are fetched through `dataUrl()`, not a bare relative path; see [Data policy](#data-policy).

### The star catalogue's tiers

[#259](https://github.com/celestiary/web/issues/259), leaner first load 3 of [#256](https://github.com/celestiary/web/issues/256); the detail, the consumers and the rebuild are in [Stars.md, brightness tiers](js/scene/Stars.md#brightness-tiers).  The bundled catalogue (`stars.dat`, 106,747 stars, 1.85 MB gzipped) was the first load's biggest item, 1,848 KB of the homepage's 2,614 KB at scene-ready.  It is now the top of the point-population engine's pyramid, the same HEALPix-by-magnitude tiles Gaia's stars use ([Gaia.md](js/scene/Gaia.md#the-engine)), under `public/large/stars/v1/` (Git LFS, `dataUrl()`), built from stars.dat and starnames.dat by `yarn stars` and checked against them by `tools/stars/stars.test.js`.

- **The bright tier** is the tree's 12 roots, by rule rather than count: every star to V 6.5 from the Sun (8,746) and every star the app names or labels whatever its magnitude (`starnames.dat`'s, the favourites, the label sheet's very luminous): 8,880, one pack, 157 KB on the wire.  So the names, the search's stars, the label sheet, the asterisms and the favourites all resolve from it.
- **The rest**, 97,867, below them as Gaia's are (48 order-1 tiles), in 12 packs, one per root cell.
- **Before scene-ready**: the manifest and the names, then the bright tier alone, then the tiles the view wants to its limit plus the engine's margin (none by the Sun; a dark-adapted or deep link's field).  `Stars.drawn` says so; `ThreeUi.sceneReady` asks it.
- **After**: the rest, at the reveal (`Stars.revealed`, beside the ephemeris) or when something needs a star not in yet: a link or frame to it waits for its tier (`Stars.whenStar`, which asks for the rest at once), the search's first query and the homepage's Enter wait for the whole catalogue (`whenComplete`), the human expansion too.  Picking indexes the stars in so far, rebuilt as tiers arrive.
- **Faded in**: a tile that lands after the reveal (`Stars.revealed` → `PointPopulation.markShown`) brings its light in over 1.8 s (`fadeGain`, on the stars' flux, `uTileGain`): the faint tiers had raised a dark field's light 20% in one frame, a pop the maintainer saw on the preview.  Gaia's tiles fade in the same way.
- **Drawn whole**: every point of every loaded tile in the field (`drawAll`), as the one geometry drew, not the engine's cut at the limit plus a margin.  Once in, the frame is main's ([Stars.md](js/scene/Stars.md#brightness-tiers) has the measurements).
- **Gaia's merge** is against stars.dat at build time; the tiers hold exactly its stars, and a test re-runs the merge's position test on Gaia's brightest against them.
- **Fallback**: `?starTiers=0`, a missing manifest or a lost pack reads `stars.dat` whole, as before.

**Set aside** (the reasons are in [Stars.md](js/scene/Stars.md#brightness-tiers)): a plain magnitude split of stars.dat into a few files (a second scheme beside Gaia's, no culling by field, a deep link waiting for every faint star); the engine's view-dependent loading and eviction (the catalogue must be held whole: it is what names, search, picking, labels and the expansion resolve against); Gaia's count-capped roots (49,152 stars and a limit that varies with density); a bright tier by magnitude alone (named faint stars, Proxima among them, would wait); a tier to the margin's 7.5 (about 22,000 stars, for light under the eye's threshold); a request a tile (60) or one file for the rest; and fetching the rest at once (measured: it was all in by scene-ready, sharing the first load's bandwidth).

### Data policy

Where external data goes depends on its size. The decision is recorded in [ROADMAP.md](ROADMAP.md#decisions-that-apply-across-tracks); this is the mechanism.

| Size | Where it lives |
|---|---|
| Small (JSON descriptors, places, name lists) | `public/data/`, plain git, relative URLs |
| Up to a few hundred MB (textures, DEMs, catalogues) | Bundled in the repo. Anything over about 1 MB goes under `public/large/<dataset>/`, which `.gitattributes` puts in Git LFS |
| GB and up (Gaia beyond its brightest ~1M) | Fetched over the network at run time, never bundled. Gaia's brightest ~1M stars, ~30 MB, are bundled under `public/large/gaia/` ([Gaia.md](js/scene/Gaia.md)) |

**Git LFS.** `.gitattributes` tracks `public/large/**`. The patterns must not match files already committed as plain blobs (`public/textures/`, `public/data/stars.dat`): git would report them as modified. Those existing assets stay as they are. Moving them into LFS would not shrink history (it isn't rewritten), would add LFS bandwidth for every clone, and the Blue Marble pyramid is about 2000 small tiles, a poor fit. The policy applies to new data. To add a dataset:

1. Put the files under `public/large/<dataset>/` and commit them (`git lfs install` once per clone, so the clean filter runs; check with `git lfs ls-files`).
2. Load them through `dataUrl('large/<dataset>/<file>')` (below), never a bare relative path.
3. Document the source, licence and rebuild recipe next to the code that uses it (e.g. [Planet.md](js/scene/Planet.md#surface-texture-sources)).

**Actions and LFS.** Workflows check out with the default `lfs: false`, then run `.github/actions/lfs`. It restores `.git/lfs` from an `actions/cache` entry keyed on the hash of `git lfs ls-files -l` (each object's id) and runs `git lfs pull`, so a build downloads only the objects the cache lacks. `lfs: true` on the checkout would download everything before any cache could help, and every download counts against the repository's LFS bandwidth quota. `ci.yml` uses the action directly, and `.github/actions/build` (used by `deploy-prod.yml` and `pr-preview.yml`) runs it first. A cache entry is visible only to the branch that saved it and to PRs against it, so builds on `main` warm it for PRs.

**The data base URL.** `js/dataUrl.js` is the one place large-data paths are resolved: `dataUrl('textures/mars.jpg')`. The base comes from the `DATA_BASE_URL` env var at build time (an esbuild `define`, `__DATA_BASE_URL__`, in `esbuild/common.js`). Empty, the default, leaves the path relative, so it resolves against the page's `<base href>` as before. Set, it prefixes the path (a plain string join, so `{z}/{x}/{y}` tile templates survive). It's used for textures (`material.js`, the monthly Earth map in `Planet.js`, the crosshairs in `shapes.js`), the star catalogue's tiers (`catalogue/cataloguePopulation.js`) and `stars.dat`, their fallback (`StarsCatalog.js`), Gaia's tiles (`gaia/gaiaPopulation.js`) and the Blue Marble tiles Cesium loads (`CesiumLayers.js`, which needs an absolute URL). Anything under `textures/`, `data/stars.dat` or `large/` must go through it. Cross-origin images need CORS, which GitHub Pages serves (`Access-Control-Allow-Origin: *`), and three's loaders request them with `crossOrigin = 'anonymous'`; the previews and production are both on celestiary.org, so theirs are same-origin anyway.

**PR previews.** `pr-preview.yml` deploys the built site under `pr-preview/pr-N/` of the `gh-pages` branch, so every preview used to carry every bundled asset (about 90 MB of textures alone) against a Pages limit of about 1 GB. `.github/large-data-paths` lists the large-data paths under `public/`. Then:

- If the PR changes none of them (`.github/scripts/large-data.sh changed`, comparing the merge commit with its first parent), the preview is built with `DATA_BASE_URL` set to the production site (`https://celestiary.org/`, `main` as deployed by `deploy-prod.yml`), the listed paths are deleted from `docs/` before the deploy, and LFS isn't fetched at all.
- If the PR changes any, or the check can't tell, the preview is a full copy with a same-origin base, as before.

So a PR that adds or changes a dataset previews its own data, and every other PR previews against the data on `main`. The catch: a preview of a PR that depends on data another unmerged PR added will 404 on it, because production doesn't have it yet. To bring a new path under this policy, add it to `.github/large-data-paths`.

## Scene Graph Structure (per planet)

```
<parent>.orbitPosition
  └── Planet (Object3D)
        └── group
              └── orbitPlane
                    ├── orbit (Line: the sampled path, or an ellipse)
                    └── orbitPosition  ← animation sets position here
                          └── planetTilt
                                └── 'new planet' (Object3D, unrotated)
                                      ├── planetLOD
                                      │     ├── [near] planet: spun node, scene.objects[name]
                                      │     │         (surface mesh + atmosphere, places;
                                      │     │          Earth's cloud shell, on CLOUD_LAYER)
                                      │     ├── [far]  single Point sprite
                                      │     └── [very far] FAR_OBJ (invisible)
                                      └── labelLOD
                                            ├── [near] FAR_OBJ
                                            ├── [mid]  SpriteSheet label
                                            └── [far]  FAR_OBJ
```

Moons follow the same pattern, parented to their planet's `orbitPosition`.
The node Animation spins (the one carrying `siderealRotationPeriod`, and
`scene.objects[name]`) is the LOD's near level, two levels below
`planetTilt`, not its child; the levels between are unrotated, so a turn
of the spun node about its +Y is a turn about the body's pole.

`group`, `orbitPlane` and `orbitPosition` are unrotated, so the position
Animation writes is in the scene's axes relative to the primary. The orbit
line (`orbitPosition.orbitShape`) is a sibling of `orbitPosition`, in the
same frame, so a body and its line share one transform chain: see
[Orbit lines](#orbit-lines). `planetTilt` is
`rotateX(-axialInclination)` for Earth; for every other body with an IAU
rotation model (`planetTilt.poleModel`) Animation turns it to the body's
equator: +Y at the pole, +X at the equator's ascending node on the ICRF
equator, where the prime meridian is measured from. The spun node then
turns by the prime meridian W (`meridianModel`), so the body frame
(coords.js: +X longitude 0) is the IAU body-fixed frame. The surface mesh
inside it is turned by the texture's own offset, `texture_longitude`, or
for Jupiter by `texture_rotation` ([Body rotation](#body-rotation-iau-prime-meridians)).

## Animation Loop

`ThreeUi.renderLoop()` runs every frame (via `renderer.setAnimationLoop`):

1. Process click events (raycasting)
2. Save `camera.quaternion` (`_savedCamQuat`)
3. `controls.update()` (TrackballControls — zoom/pan only; rotation disabled)
4. Restore `camera.quaternion` — suppresses the `lookAt` that TrackballControls applies each frame, so camera orientation is owned by navigation tweens and user input
5. `_applyAsymptoticZoom()` — remaps zoom to altitude space and adjusts `camera.near`
6. `animationCb(scene)` → `Animation.animate(scene)`:
   - `Time.updateTime()` advances simulation clock by `timeDelta * timeScale`
   - `planetCoords(julianDay)` gives the heliocentric XYZ of the 8 major planets: `vsop87c`'s, or before its chunk has loaded, the mean elements' (`planetsApprox.js`), or between them while it hands over ([before the ephemeris loads](#before-the-ephemeris-loads))
   - `updateMoon(julianDay)` computes the Moon's geocentric position (lunarTheory.js)
   - the J2000 → date precession rotation, for the mean elements and the IAU rotation models (`setDate`)
   - `animateSystem()` recurses the scene graph, setting orbit positions and body orientations (IAU pole and prime meridian; Earth's GMST), and turning the orbit lines to the date (asking for a rebuild when one is due)
   - `orbitPaths.pump()` runs queued orbit-line rebuilds, a few milliseconds a frame ([Orbit lines](#orbit-lines))
   - `Scene.syncFollow()` hangs the camera platform on the followed body's `orbitPosition` while following is on (on after a go, and `f`), and on the body's frame when it goes off, so the camera rides or leaves the body from this frame's positions on ([follow](#follow))
   - If `targets.track` is on (`t`), calls `lookAtTarget({keepRoll: true})` each frame: the camera turns to centre the target, whatever it is, by the shortest turn, so the view's roll stays as it is ([the target](#the-target))
7. Camera-look tween update (`targets.tween`)
8. `_applyCameraArrowKeys()` — apply held-key pitch/roll last so they always win
9. Render: the scene into `_sceneRT` (linear, half-float, in exposure units), Cesium's layers composited into it, Earth's cloud shell over both ([Planet.md, clouds](js/scene/Planet.md#clouds)) and, up close, the volumetric clouds' march into their own target ([atmos/clouds.md](js/scene/atmos/clouds.md)), then the atmosphere pass to the screen, which adds the sky (the clouds composited in it), and tone-maps once (PBR Neutral), then the label overlay.  See [HDR pipeline](#hdr-pipeline).

The whole of `renderLoop()` is bracketed by `stats.begin()`/`stats.end()` while the performance panel is showing ([Performance panel](#performance-panel)); hidden, it costs nothing.  Under `?perf=1` it is bracketed again by `perf.frameBegin()`/`perf.frameEnd()`, and each pass by `perf.begin(name)`/`perf.end(name)` ([Perf overlay](#perf-overlay)); without `?perf=1` those return at their first line.

## Orbital Mechanics

- **Major planets** (Mercury–Neptune): VSOP87c theory via the `vsop87` npm package, giving high-accuracy heliocentric ecliptic coordinates.  Its coefficients are 2.6 MB, so they are a chunk of their own, fetched after the first frame; until they are in the planets are on mean elements ([Before the ephemeris loads](#before-the-ephemeris-loads))
- **The Moon**: the truncated ELP-2000/82 of Meeus, *Astronomical Algorithms* ch. 47 (`js/scene/lunarTheory.js`), geocentric. Against JPL Horizons from 1950 to 2050 (offline fixture `lunarTheory.horizons.json`) it's within 4.3″ and 4.2 km. Its orientation is the IAU model's ([Body rotation](#body-rotation-iau-prime-meridians)), so the near side faces Earth with the real optical and physical libration; it used to follow Cassini's laws (Meeus ch. 53), which agree to 0.04°. Its orbit line is its path over a sidereal month ([Orbit lines](#orbit-lines)); the mean ellipse of date, which it used to be, misses the Moon by up to a few per cent (evection, variation).
- **Other moons and Pluto** (#6): Keplerian ellipses from published mean elements (`js/scene/meanElements.js`), with the source, reference plane and epoch in each body's JSON `orbit` block. Details below.
- **Body orientation**: every body but Earth is turned by its IAU WGCCRE rotation model, pole and prime meridian ([Body rotation](#body-rotation-iau-prime-meridians)), so the moons' planes and Saturn's rings agree with the drawn equator and each body's longitude 0 is where the report puts it. Before #6, `rotateX(-axialInclination)` could only lean a pole toward ecliptic longitude 90°, right for Earth alone (Jupiter's and Saturn's poles were 5° off, Mars's 37°, Neptune's 51°, Uranus's 168°); before #96, every body but Earth and the Moon turned once a day from an arbitrary meridian.

### Mean elements (Pluto and the moons)

- **Sources.** The moons: JPL SSD's planetary satellite mean elements (https://ssd.jpl.nasa.gov/sats/elem/, epoch J2000 TDB), a precessing ellipse fitted to each JPL satellite ephemeris. Pluto: Standish's Keplerian elements for approximate positions of the planets, table 1 (1800–2050), ecliptic and equinox of J2000, with rates per century.
- **Reference planes.** The satellite elements are referred to a plane given by its pole in ICRF: the moon's **Laplace plane** (the plane its orbit precesses about, between the planet's equator and its orbit; the Galileans, Saturn's, Mars's and Neptune's moons) or the planet's **equator** (URA182's Uranian moons and Charon, with the IAU pole). The node Ω is measured from that plane's ascending node on the ICRF equator. So the orbit is Rx(−ε₀)·Rz(α + 90°)·Rx(90° − δ) (plane → ecliptic J2000) · Rz(Ω)·Rx(i)·Rz(ω) (orbit → plane), in scene axes Ry for Rz. ε₀ is 84381.448″ (`celestialFrame.J2000_OBLIQUITY_DEG`), Horizons' definition of the J2000 ecliptic. Saturn's equator is 28° from the ecliptic, so "relative to the ecliptic" against "relative to the equator" is the whole difference for Titan.
- **To date.** Everything is computed in the ecliptic of J2000 and turned into the scene's frame by `precessionQuaternion(J2000, date)`, once a frame (`Animation.setDate`), at TT. The orbit line is the same ellipse, laid with the same rotation, scale and focus offset as the body (`Animation.layOrbitShape`), so it passes through it; its unit ellipse is redrawn when e drifts (Pluto's, by Standish's rates).
- **Precession.** ω and Ω move at constant rates. The table lists the periods as magnitudes; the JSON's `apsidalPeriod` and `nodalPeriod` are signed. Nodes regress on prograde orbits and advance on Triton's retrograde one. Apsides advance, except where a resonance drives them backwards: Io and Europa (Laplace resonance, ϖ̇ = 2n(Europa) − n(Io) = −0.74°/day) and Hyperion (4:3 with Titan).
- **What the table's period means varies by ephemeris.** `period` with `periodOf`: JUP365's P is the period of the mean anomaly (Io's 1.762732 d, where its sidereal period is 1.769138 d), SAT441's is that of the mean longitude. Each reading was chosen by fitting Horizons, where the other is tens of degrees off within a decade.
- **Where the table isn't used as is** (each noted in the body's JSON):
  - Saturn's moons (SAT441): the tabulated ω and M put them 60–160° from Horizons at their own epoch, with no common origin offset, while planes and rates agree. They take e, ω and M from Horizons' osculating elements at J2000, re-referred to the table's plane (the recipe is a test in `meanElements.test.js`).
  - Triton: node period 688 yr, the rate of the argument N in the IAU model of Neptune's pole (which Triton drives), not the table's 340.379 yr, which is 3.5° off Horizons by 2050.
- **Accuracy**, against Horizons from 2000 to 2050 (offline fixture `meanElements.horizons.json`, tested in `meanElements.test.js`), as out-of-plane and along-track errors:
  - Galileans: plane ≤ 0.09°. Phase: Io 1.4°, Europa 3.1° by 2050 (mean elements can't follow the resonant moons' mutual perturbations), Ganymede and Callisto ≤ 0.16°.
  - Titan: plane ≤ 0.29°, phase ≤ 0.02°, 203 km. Tethys, Dione, Rhea, Iapetus: plane ≤ 1.5°, phase ≤ 2.9°.
  - Pluto: ≤ 0.011° (1.1 × 10⁶ km in distance, of 5 × 10⁹).
  - Planes only, since their phase drifts by tens of degrees: Phobos ≤ 1.6° (its 2.3 yr node period is printed to two figures, and 50 years is 22 turns), Hyperion 1.5° (chaotic), the rest ≤ 0.3°. The table's periods are too coarse for Phobos, Deimos and Triton over decades, URA182's epoch angles don't match Horizons, and Janus swaps orbits with Epimetheus every four years.
  - A better model per system: Lieske's E5 for the Galileans, TASS 1.7 for Saturn's moons, GUST86 for Uranus's, or the JPL ephemerides themselves.
- **Bodies without elements** (only the demo descriptors, e.g. `earth-as-moon.json`) keep the old flat ellipse in the ecliptic, centred on the primary.

### Before the ephemeris loads

VSOP87C's coefficients (the `vsop87` package's base64 wasm, 2.58 MB, 1.37 MB gzipped) used to be most of the first chunk's 3.2 MB ([#256](https://github.com/celestiary/web/issues/256), [#257](https://github.com/celestiary/web/issues/257)).  They are in a chunk of their own now, `import()`ed from `Animation.js` (`fetchVsop`) and from the guide's VSOP page; nothing imports `vsop.js` or `vsop87` statically, and `yarn bundle-check` fails if something does (`esbuild/firstLoad.js`: the output files the entry and the App route import statically must hold no `vsop87`).  The first load is then `index.js`, the App chunk and its shared chunks: 2.15 MB (668 KB gzipped) against 4.73 MB (2.04 MB).

- **When it loads.**  `Animation.loadEphemeris()`: `Celestiary.frame` calls it as the first load's reveal starts (the scene is on screen, so the 1.4 MB doesn't compete with the stars and the target's surface), and `Animation.animate` calls it `LOAD_AFTER_MS` (10 s) after its first frame if no one has, for scenes with no reveal (the guide's).  A failed fetch is logged once and leaves the planets on the stand-in (and their orbit lines); it isn't retried, since a browser keeps a failed `import()` for the page's life: a reload does.  A second `Animation` takes the loaded function at once (`loadedVsop`).  `onEphemeris` tells a listener.
- **The stand-in** (`scene/planetsApprox.js`): Standish's table 1 mean elements for the eight planets (JPL, 1800-2050; Pluto's are in its JSON, the same form), read by `meanElements.js` and precessed to the date as Pluto's are; Earth is the Earth-Moon barycentre's element less the Moon's share of the lunar position.  Before this the planets sat at the origin until the series loaded (a few milliseconds, when it was in the first chunk).  Against VSOP87C, 1800-2050 (`planetsApprox.test.js`, each year): Mercury within 7,000 km, Venus 15,000, Earth 20,000 (0.01° from the Sun); every planet within 0.25° of VSOP87C's direction, seen from the Sun or from Earth, the worst Saturn's 0.22° and Jupiter's 0.17°; 2020-2035 within 0.1° from Earth.  The Sun's direction from Earth is within 0.007° (Meeus's `lowPrecisionSun`, which `_sunAt` and the tour's plan use in the gap, is 0.006° from VSOP87C: the plans for 32 times through the seasons are the same, `nightSide.test.js`).  Outside 1800-2050 it degrades, to tens of degrees at the ends of the supported dates (the table-2 terms for Jupiter to Neptune aren't kept): a permalink to 3000 BC shows the planets in the wrong places for the second or two until the series is in, then they glide.
- **The hand-over** (`Animation.planetCoords`).  The frame after the series is in, each planet's place starts as the stand-in's and glides to VSOP87C's over `HANDOVER_MS` (1.5 s), smoothstep, `vsop + w (standIn - vsop)` with both evaluated at the frame's date, so a date set meanwhile (a permalink, a flight's time plan) is right too.  Nothing jumps: the steepest frame moves a planet 1.7% of its error.  The jump there would have been, 2020-2035, up to 17,000 km for Earth and 0.085° for Jupiter and Saturn in the sky.  A camera that rides a body (`goTo`, `f`: the platform a child of its `orbitPosition`) moves with it, so only the other bodies glide in its sky; a camera in the Sun's frame near a planet sees the planet slide by up to 20,000 km over the 1.5 s.  Bodies on mean elements (Pluto, the moons) and the Moon (`lunarTheory.js`) don't depend on the series and don't move.
- **Orbit lines** are drawn at once from the stand-in's samples and rebuilt from the series when it arrives (`OrbitPath`'s `approximate`: a line built while it was on the stand-in, or begun there, is stale once it stops), in the same budgeted slices as any rebuild.  The lines differ by the stand-in's error, a hair at the orbit's scale.
- **Permalinks, flights, the tour.**  A link's camera is in its body's frame (`_restoreView`: the platform on the body, lat/lng/altitude from the body's own axes), so it lands in the same place with or without the series; the time is set and the bodies placed (`animateAtJD`) on the stand-in or the series, whichever is in.  In the gap what differs is where the *other* planets are in the sky, up to 0.09° for Jupiter and Saturn in 2026 (the Moon hiding Jupiter, #192, can be out by up to a sixth of the Moon's width until the series is in, and then Jupiter glides into the occultation).  A flight's end is computed each frame in the body's frame, so the hand-over mid-flight moves nothing the camera is placed against.  The tour's plan and tonight's sky use Meeus's Sun in the gap and aren't remade.
- **Tests** don't take the loaded function from other files: `new Animation(time, null)` is "none yet", `setEphemeris(fn)` is its arrival, and the series is read from `vsop87/dist/vsop87c-wasm`, since `Celestiary.test.js` mocks `./vsop` for the whole process (`Animation.handover.test.js`).

### Body rotation (IAU prime meridians)

Each body's orientation is the IAU WGCCRE model (#96): its north pole's
right ascension α0 and declination δ0 in ICRF and its prime meridian W,
the angle along its equator, eastward, from the equator's ascending node
on the ICRF equator to longitude 0, as functions of TDB:
W = W0 + Ẇ·d (+ a quadratic term for Phobos and the Moon) plus the
report's periodic terms in the system's angles (Mars and its moons,
Jupiter and its moons, Saturn's, Uranus's and Neptune's moons, Neptune, the
Moon, Mercury's libration).

- **Source.** `js/scene/iauRotation.json`, generated by
  `tools/iau/pckRotation.mjs` from NAIF's `pck00011.tpc`, which transcribes
  the 2015 report (Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22),
  with its correction for Phobos and the 2009 report's Moon and Earth (the
  2015 report gives neither). The JSON's `source`, and each body's, says
  which. The bodies' JSON no longer carry a `pole`.
- **In the scene.** `iauRotation.bodyQuaternion` is
  Rz(α0 + 90°)·Rx(90° − δ0)·Rz(W) (body frame → ICRF), in scene axes and
  the ecliptic of J2000 (`meanElements.referencePlaneQuaternion` for the
  first two), and Animation premultiplies the J2000 → date precession.
  `planetTilt` takes the equator (pole and node), the spun node W
  ([Scene graph](#scene-graph-structure-per-planet)). The time argument is
  TT, within 2 ms of TDB.
- **Retrograde rotators** (Venus, Uranus, Triton, Titania, Oberon) have a
  decreasing W about the IAU north pole, and Pluto and Charon's pole is the
  one they turn prograde about, south of the ecliptic (the 2009 report's
  rule for dwarf planets). The same formula serves all of them.
- **Earth keeps GMST** (Planet.js `OWN_ORIENTATION`), with `planetTilt`'s
  rotateX(−ε): against Horizons' ITRF93 it's within 0.002° in longitude
  and 0.007° in latitude (nutation and the obliquity of date left out),
  where the IAU's own low-precision Earth (2009; its W is in TDB, while
  Earth turns with UT1) is 0.14° off. **The Moon** moved onto the IAU model:
  within 0.0024° of Horizons' mean-Earth frame, where Cassini's laws
  (its orientation before) were 0.035° off, without physical libration.
- **Checked** against JPL Horizons' sub-observer points (offline fixture
  `iauRotation.horizons.json`, `tools/iau/fetchHorizons.mjs`; tests in
  `iauRotation.test.js`) at 1950, 2000, 2026 and 2050: every modelled body
  from Earth or from its planet within 0.0025° (Horizons' `IAU_*` frames are
  the same report). The test rebuilds each point from the row's light time
  and astrometric direction, so it checks the orientation alone.
- **Light time isn't modelled**: the scene is geometric, so a body is drawn
  turned as it is at the simulation time, while from Earth it's seen as it
  was a light time earlier. Jupiter's central meridian as drawn from Earth
  runs ahead of what a telescope shows by Ẇ·τ, 20° to 30°; Mars's by 2° to 7°.
- **Synchronous moons face their planets** as a result, not by
  construction: by Horizons, every modelled moon's sub-planet longitude is
  within 6° of 0 from 1950 to 2050 (eccentricity's optical libration). As
  drawn, with the mean-element positions, the Galileans are within 4°,
  Tethys, Dione, Rhea, Titan and Iapetus 6°, Proteus 7°, Charon 2°, the Moon
  within its libration. Phobos, Deimos, Janus, Triton, Titania and Oberon
  aren't: their mean elements lose their orbital phase (Phobos and Deimos
  up to 170° by 1950 and 2050, Titania and Oberon at every date), which is
  a position error for #97, not an orientation one.
- **Textures** must put their own 0° at the prime meridian. Three's sphere
  maps the texture's centre column to longitude 0; a texture centred
  elsewhere says so with `texture_longitude` (the east longitude of its
  centre), which turns the surface mesh in the body frame. Io's, Europa's,
  Ganymede's, Callisto's and Iapetus's are centred on 180°. Jupiter's clouds
  turn with System II, not the IAU's System III, so its texture is turned by
  `texture_rotation` instead, putting the Great Red Spot at its observed
  System II longitude. Each texture's check is in
  [Planet.md](js/scene/Planet.md#texture-longitudes).
- **Hyperion** has no model (its rotation is chaotic) and keeps its
  tilt; demo descriptors without a model turn once per sidereal period
  from an arbitrary meridian.
- **Permalinks** hold the camera in the body frame (lat, lng), so a link
  to any body other than Earth and the Moon made before #96 restores to a
  different place around the body. `tools/parity/views.json`'s Mars views
  were re-timed (by under half a sol) so the body sits as it did, and the
  Sun within 0.25° of where it was.

### Orbit lines

Each orbit line is drawn from the ephemeris its body is placed by, so the
body sits on it (within 1e-5 of the orbit's size, `orbitPath.test.js`,
at 1900, 2026 and 2500). Before, every line was a flat ellipse from the
JSON's a and e, centred on the primary: the planets' had no inclination,
node or perihelion direction, and sat a·e off centre, so their points
were visibly off their lines (Mercury by ~10 px in an inner-system view).

- **Drawn as a wide line strip** (`wideLines.js`, `newWideLineStrip`), as
  the asterisms are: 1.5 px, antialiased, additive.  Its geometry keeps a
  `Line`'s `position` attribute and `setDrawRange`, which everything below
  writes as before; an instanced view of the same array draws vertex i to
  i + 1, through the ordinary model-view, so the float64-origin precision
  below carries over unchanged.  It's on the overlay layer, with the
  labels: drawn after the atmosphere pass, depth-tested against the scene
  depth that pass writes, writing none.  In the scene pass its depth told
  the atmosphere there was something at that distance, so from Earth's
  surface its own orbit (end-on, near) cut the sky's ray short: a dark
  blotch in the sky.
- **Planets and the Moon: the sampled path** (`js/scene/orbitPath.js`,
  `OrbitPath`). One sidereal period of the body's path around its primary,
  centred on the simulation date, 1001 vertices in a `Line` whose one
  `BufferGeometry` is rewritten in place. The line is open: a perturbed
  path doesn't close, and the gap sits opposite the body. It's under 0.2%
  of the orbit for the planets (Saturn's reaches 0.8% at 2500, the great
  inequality) and ~1% for the Moon (2,500–5,000 km: evection and the
  perigee's advance).
- **Frame.** The samples are in the ecliptic of J2000: each is taken out
  of the frame of its own date with the inverse of the rotation Animation
  applies at that date. The line's group is turned by that frame's
  `this.precession` (J2000 → date), as the mean-element orbits are, so
  precession never needs a rebuild, and at any date the line passes
  through the body's position exactly where the samples do.
- **The Moon** is sampled directly: Meeus 47 costs ~10 µs a call.
- **Planets** are sparse. VSOP87C evaluates all eight planets in every
  call, ~2 ms (wasm), so a few hundred samples for eight planets would be
  seconds. A two-body ellipse osculating the path at the centre date
  (velocity by central difference) carries the shape; VSOP87C is sampled
  at even times over the period only for the departure from it, which is
  interpolated (four-point Lagrange): 17 samples for the terrestrial
  planets, 33 for Jupiter and Saturn (their mutual perturbations), and at
  least eight a Jupiter year for the Sun's wobble in heliocentric
  positions (Uranus 58, Neptune 112).
  Vertices are even in eccentric anomaly. Earth's path is the Earth–Moon
  barycentre's, which is smooth, plus its monthly ~4,700 km wobble added
  per vertex from the lunar theory.
- **The window is the JSON's `siderealOrbitPeriod`,** not the osculating
  period: the Sun's reflex velocity puts Neptune's osculating period off
  by ~1%. The planets' periods were 365-day-year values, 0.07% short;
  they're now from Standish's mean-longitude rates (JPL approximate
  positions, table 1), as Pluto's elements are.
- **Rebuilds** happen when the date has moved 1/50 of a period from the
  line's centre, or jumped. Rebuilds are generators queued in
  `Animation.orbitPaths` and run by `pump()` a slice at a time (a VSOP87C
  call, or 64 vertices) within 4 ms a frame (`FRAME_BUDGET_MS`), or 12 ms
  while the next line doesn't hold its body at the latest date
  (`CATCH_UP_BUDGET_MS`: its first build, a jump, or a time rate faster
  than rebuilds), so none is on the per-frame path. A rebuild costs 20–36
  VSOP87C calls (~2 ms each, in bun and Chromium alike), 35–60 ms of work
  in Chromium; Uranus's and Neptune's ~110 and ~200 ms; the Moon's ~5 ms.
  All nine lines after a jump are ~0.6 s of work, about 50 frames.
- **A line is never hidden once built**, only before its first build.
  A path's shape changes over decades to millennia, so the last line
  stays a good picture until the next is ready, which then replaces it
  whole: a rebuild writes a scratch array and copies it into the geometry
  in one step, so a part-built line is never drawn. The first version
  hid a line whose window had passed its body; at high time rates the
  date outran the rebuilds (Mercury's is ~4 frames, and at 30 days a
  frame its 88-day window is passed in 2), so the inner planets' lines
  flickered, and worse, below.
- **Always for the latest date.** A queued rebuild takes the latest date
  asked; one the date no longer needs (time turned back into the line's
  window) is dropped. A running rebuild whose window won't hold the new
  date (a jump) restarts for it, **once**: the first version restarted
  on every such request, so at a date running faster than a rebuild
  (Mercury at 30 days a frame, any planet at a year a frame) it
  restarted every frame, never finished, and held up the queue behind
  it. Now it finishes, and Animation asks again for the date then, so
  the lines take turns, each at most a couple of rebuilds behind the
  date (`orbitPath.test.js`, *high time rates and jumps*, with a clock
  paced by VSOP87C's real cost).
- **Through the body's centre, close up** (`js/scene/bodyLine.js`,
  `BodyLine`). Within 1e-3 of the body's radius as the GPU draws it
  (`orbitPath.test.js`, *as rendered*: float32 vertices through a float32
  model-view with the camera at the body), for the planets, the Moon,
  Pluto and the mean-element moons. Two things kept the lines off by up
  to 0.8 of Neptune's radius and 24 of Pluto's:
  - **Chord sag.** 1000 segments over an orbit bow inside the curve by up
    to a·(2π/1000)²/8 ≈ 4.9e-6·a: Earth 740 km, Mars 1,100 km, Neptune
    22,000 km, Pluto 29,000 km. The 1e-5·a test allowed it. So a fine arc
    of the same curve (the sparse paths' ellipse plus interpolated
    departure, no new VSOP87C calls; the Moon's series; the unit ellipse)
    is spliced in over the body's coarse segment and one each side, at a
    spacing whose sag is under 2.5e-4 radii (`fineSteps`: Moon 3 steps a
    segment, Earth 22, Neptune 61, Pluto 256, capped). An interpolated
    path's small offset from the body's own position is added to the arc,
    faded out to nothing at its ends, where it joins the coarse vertices
    exactly.
  - **float32.** The vertices (in the geometry, and on the GPU with the
    camera offset) are good to ~6e-8 of their size: ~0.3 radii for Pluto,
    ~0.01 for Neptune. The coarse line is kept in float64 and written
    relative to an origin at the body, which the line's `position` puts
    back (three composes matrices in float64): near the body the numbers
    are small, and far vertices lose precision only where it's invisible.
    It's the same problem `rte.js` solves for the stars, solved here on
    the CPU, as a line has few vertices.
  - **Cost.** Each frame is a comparison or two per body; the arc and
    origin are redone when the body leaves its coarse segment, moves
    1000 radii from the origin, or is 5e-4 radii off the arc: a few
    hundred curve points and one upload of the drawn range. Lines that
    need neither (one step a segment, and float32 already fine: most
    moons) are left as built. For the whole solar system in Chromium
    (SwiftShader, a loaded machine): 0.06–0.09 ms a frame at real time,
    0.4–0.5 ms at a day a second, 0.7–1.0 ms at 30 days a frame. Earth's
    arc is the dearest: its monthly wobble comes from the lunar series,
    per point.
  - A new build is spliced around the body at once. Off its window (a
    stale line after a jump), a line is drawn plain until rebuilt.
  - The mean-element ellipses are redrawn when e has drifted enough to
    move them 1e-4 of the body's radius (Pluto's, by Standish's rates).
- **Non-finite input is refused:** `OrbitPaths.request` ignores a
  non-finite date, and a build whose samples aren't all finite leaves
  the last line as it was. Animation skips a frame whose date isn't
  finite and never sets a non-finite position. Time's clamp
  ([Frames and time](#frames-and-time)) keeps dates in range in the
  first place.
- **Other moons and Pluto** keep their mean-element ellipse of date, laid
  each frame (`layOrbitShape`): that ellipse is their ephemeris.
- **Bodies without elements** (demo descriptors) keep the flat ellipse.

### The info panel

The target's facts, revealed in tiers rather than as its descriptor's
fields (`ControlPanel`, `js/infoPanel.js`; the plan and the design system
it follows: [design/UI.md](design/UI.md)).

- **A head, rows, sections.**  The head has the name, the kind and one fact
  (how far out it orbits, or a star's class); under it the few rows a
  visitor asks first (radius, day, year, moons; a star's class, radius and
  mass), with periods to a glance's precision (`periodText`); then
  `<details>` sections, shut until asked: Orbit, Physical, Space around,
  Rings, Atmosphere, Moons (open), More data (the descriptor's other fields,
  in words, nested ones on a line).  Stars from the catalogue and SPARC
  galaxies get the same head and rows.
- **Strings, then wiring.**  `infoPanel.js` builds the HTML as strings, so
  the structure is tested in bun with no DOM; `ControlPanel` puts it in
  `#nav-info-id` and wires the orbit switches, the fold control and the
  sections' toggles (heard on capture: a `toggle` doesn't bubble).
- **Opaque**, `--surface`: over a starfield even 3% of a bright label read
  through the 97% sheet, and the old translucent card let labels and lines
  run over the text.
- **Phones: a bottom sheet** (`js/infoSheet.js`), at 600px wide or less:
  peek (the head), half (the summary) and full (88% of the scene).  Drag
  the head or tap it to step; the detent lasts through the panel's
  re-renders.  It sits above the widgets drawer's sheet; the bottom
  controls and settings sit above its peek (`--info-sheet-bottom`) and hide
  while it's raised (`html.info-raised`); Cesium's credits ride above both
  sheets.  A drag's release eases from where the finger let go: measuring
  the detents lays the sheet out at each, so it's laid out again at the
  release height before the transition is let run (it had started from
  full, the last measured, and jumped to the top).  Its height eases over 300 ms; on SwiftShader a busy main thread
  stalls the transition, so a probe that reads its height turns it off.

### Orbital elements

A body's six Keplerian elements, listed in its info panel and drawn on its
orbit (`js/scene/orbitElements.js`, `js/scene/orbitDiagram.js`;
[#272](https://github.com/celestiary/web/issues/272) is the wider orbits
work it starts).

- **Osculating for the planets and the Moon** (`Animation.orbitElements`,
  `orbitElements.js` `elementsFromState`): the two-body ellipse through the
  body's place and velocity of the moment, from the ephemeris that draws
  it (VSOP87C, or the stand-in before it loads; the lunar theory), the
  velocity by a central difference over 1/1000 of the period, with GM the
  Sun's and the planet's (the Earth's and the Moon's for the Moon).  So
  the diagram meets the body at any zoom.  Mean elements didn't: the
  maintainer's screenshots near the Earth and the Moon showed the lines
  missing both.  Against the ephemerides on 2026 Oct 12, the Moon's mean
  ellipse missed it by 2,900 to 12,500 km (up to 1.8°: the Sun's pull,
  evection and variation), Earth's by ~10,000 km, Mars's ~26,000 km,
  Jupiter's ~460,000 km, more than Io's orbit.  Osculating, each is
  within a km (`Animation.elements.test.js`).  The cost: the values move.
  The Moon's eccentricity swings between ~0.026 and ~0.077 in a month and
  its perigee with it; the panel says "osculating elements, of the
  moment".  Earth's are the Earth-Moon barycentre's, ~4,700 km from the
  Earth's centre, inside it: osculating to the Earth itself would wobble
  its perihelion by a degree a month.  In the ecliptic and equinox of
  date (the ephemerides'), so the diagram isn't precessed.  A planet's are
  made again at most every 250 ms (VSOP87C costs ~2 ms a call, three a
  making), the Moon's whenever the date moves (~10 µs); between, the
  body is run on along the last ellipse at its mean motion.  A set made
  before VSOP87C was in (the stand-in, ~10,000 km off Earth's place; the
  panel asks on load) is made again once it is.
- **Two lines through Earth, on purpose.**  Earth's orbit line
  (`orbitPath.js`) is its own path, the barycentre's plus its monthly
  wobble, so it passes through Earth's centre; the diagram's ellipse is
  the barycentre's osculating ellipse, so it passes through the
  barycentre, 4,700 km away, inside the Earth.
- **The ellipse is drawn densest at the body** (`ORBIT_POINTS`, cubic in
  eccentric anomaly about it): evenly spaced, a chord of the old
  193-vertex ellipse fell up to a(1 − cos(π/192)) inside the curve, 20,000
  km of Earth's and 90 km of Europa's, which the maintainer saw as the
  ellipse missing Earth and Europa's mean line overshooting it.
- **Mean elements for the rest** (`elementsOfDate`): Pluto and the moons
  are placed by their mean elements (`meanElements.js` `elementsAt`, which
  `orbitAt` now uses too), in their Laplace plane or their planet's
  equator, so those are exact for them.  The planets' Standish elements
  and the Moon's Meeus 47 mean node, perigee and longitude are the
  fallback before a frame has run; a demo descriptor gets its JSON's
  elements run on at its period.  The pericentre and the body's place are
  listed in the source's form: ϖ and L for the planets, the Moon and
  Pluto; ω and M for the moons.  A negative inclination (Standish's Earth
  after J2000) is turned round (i > 0, Ω + 180°, ϖ kept).
- **The panel** (`ControlPanel.orbitListHtml`): the Orbit section of the
  info panel ([the info panel](#the-info-panel)): a lead (what the elements
  are and their frame, then `Show all · none`, and `clear every orbit` while
  other bodies have some on); the orbit period (sidereal); the six elements
  as rows, each with its symbol, name, value in mono and a short line in its
  colour, the place's with the true place under the mean (λ = ϖ + ν, or ν);
  then the block's other fields as rows.  The values, and which elements are
  on, follow the date and the scene four times a second while the section is
  open (`ControlPanel.frame`).  A click (or Enter, or Space) turns an element
  on or off; a hover or focus previews one.
- **The panel's sections, open or shut, are in the link** (the `info:`
  token, [design/URLs.md](design/URLs.md#info-token)): the whole panel
  folded, and each section (`orbit`, `physical`, `space`, `atmosphere`)
  opened or shut against its default, for every body alike, so moving from
  Earth to Venus keeps the orbit section open (`ControlPanel.uiState`,
  `_applyUiState`, `_onToggle`).
- **Stateful, on many bodies at once** (`Scene` `toggleOrbitElement`,
  `setOrbitElements`, `clearOrbitElements`, `previewOrbitElement`): the
  scene keeps, per body, the set of elements on, by their short codes
  (`orbitElements.js` `ELEMENT_CODES`: `peri` for ϖ or ω and `at` for L or
  M, read as the body lists them, `keyOfCode`).  Moving to another body
  keeps them, so Earth's and Venus's planes and perihelia can be compared
  side by side.  The state is in the link as the `orbits:` token
  ([design/URLs.md](design/URLs.md#orbits-token)), restored on the first
  load; a body that loads after shows its diagram then (`Scene.add`).
- **The diagram** (`OrbitDiagram`): the reference plane and direction, the
  orbit's plane, the line of nodes and the ascending node, the arcs of Ω,
  i, ω and M, the major and minor axes, the centre, the empty focus and
  the radius to the body: wide-line strips (`wideLines.js`) and two faint
  plane fills, drawn in units of a in the reference plane's axes (as
  `meanElements.js` has them: the plane XZ, the pole +Y, the reference
  direction +X).  Each part is lit by the elements it shows; `highlight`
  takes any number of elements and draws their parts bright, the
  reference frame and the ellipse faint, and hides the rest.  The mean
  anomaly's line runs from the focus to the orbit, at M's angle from
  pericentre, and a white arc with an arrowhead runs from it to the
  radius to the body: the equation of centre, ν − M.  In the app the
  points are named (`labels`): the reference direction (♈︎ for the
  ecliptic, the node on the ICRF equator for a moon), the ascending node,
  pericentre, the centre, the empty focus, each shown while its part is
  lit.
- **Faded from the body** (`_fade`): every line and both plane fills are at
  full opacity at the body and fall linearly with straight-line distance
  to half at the far side of the orbit (its major axis' span), so the eye
  goes to the body and the elements meeting it, and nested or
  near-coplanar orbits (the inner planets') don't crowd one another.  The
  wide-line shader takes an optional fade (`uFadeCentre`, `uFadeRange`,
  `uFadeMin`, off unless set, so no other line changes); the fills are a
  small shader that does the same in the diagram's frame (`uToDiagram`).
  Labels aren't faded.  The far side's opacity is a slider in the orbit
  list's lead ("far side", 0 to 100%, default 50; `Scene.setOrbitFade`, for
  every diagram), in the link as the `orbits:` token's `fade=`, and on the
  guide's page too.
- **Barycentres.**  `setMassRatio(m / (M + m))`, from the bodies' masses
  (Scene): the two bodies' barycentre on the line to the body, m/(M + m)
  of the way, and the primary's own orbit about it, the body's ellipse
  scaled by that and turned half round, which passes through the
  primary's centre.  The Earth-Moon barycentre is 4,700 km from the
  Earth's centre, so Earth's small orbit is inside it; Pluto and Charon's
  is outside Pluto; Jupiter's makes the Sun's centre circle a point just
  outside its surface.  Under 1e-4 (the Sun and Earth's, 450 km at 1 AU)
  they aren't drawn.  These parts and the labels are drawn through the
  bodies (`depthTest` off): they're inside them.  Where a diagram's body
  place isn't the body (Earth's heliocentric one, the barycentre's), a
  white line marks the way to the body (`setBodyOffset`, from
  `Animation.layOrbitDiagram`), past 100 km.  A point two diagrams name
  is named once: with the Moon's barycentre lit, Earth's diagram's own
  "Earth–Moon barycentre" is hidden (`hideLabel`, `Scene._syncOrbitDiagrams`).  Each angle's
  arc ends in an arrowhead, the way the angle runs (`arcWithHead`): Ω from
  the reference direction, i up from the reference plane at the node, ω
  from the node, M from pericentre, all prograde.  ϖ and L are broken angles, so they light Ω's arc and
  ω's (and M's) together.
- **In the scene** (`Scene._syncOrbitDiagrams`): a diagram per body with
  elements on (and the previewed one), made on first use beside its orbit
  line (in the primary's frame, on the overlay layer), shown whatever `o`
  says, since it was asked for.  Each frame it shows,
  `Animation.layOrbitDiagram` lays it on the elements of the date, scaled
  to a and turned by the elements' frame and the precession, as
  `placeByElements` turns an orbit.  The radius to the body ends on the
  body (checked for Pluto, Io and the Moon in a browser).
- **The guide's orbit page** (`/guide/orbit`, `js/guide/Orbit.jsx`) drives
  the same diagram in React Three Fiber.  The app's orbit list links to it
  ("see it in the guide") with the body's elements of the moment and those
  lit (the guide's `orbit:` token, [design/URLs.md](design/URLs.md#the-guides-orbit-token)),
  so any orbit the app has, a moon's too, can be taken apart there.  Its
  controls are a fixed width with fixed cells and tabular numerals, so
  running the orbit doesn't reflow the page.  It has sliders for e, i, Ω,
  ϖ and L, the planets' elements as presets, and the same clicks (any number on;
  none on draws them all) and hover.  Drawn
  straight to an sRGB canvas, its lines take their colours as they are
  (`screen`); in the app they go through the HDR scene buffer.


### Frames and time

- **The scene frame is the mean ecliptic and equinox *of date*,** not J2000: VSOP87**C** is the of-date series (VSOP87A is J2000). Checked against Meeus example 25.b: VSOP87C gives the Sun's longitude as 199.9073° at 1992 Oct 13.0 (Meeus: 199.907372°), while VSOP87A gives 200.008°. Meeus ch. 47 is in the same frame, so the Moon's geocentric (λ, β, Δ) goes straight in, with no precession.
- **Axis remap**, for VSOP87C's `(x, y, z)` and any ecliptic vector: scene `(x, z, −y)`, i.e. X = equinox, Y = north ecliptic pole, Z = −ecliptic Y. A rotation about ecliptic Z is a rotation about scene Y by the same angle.
- **Body frames** (coords.js): +Y the north pole, +X the prime meridian, east longitude toward −Z. The same remap from a body's (x = longitude 0, y = 90° E, z = north), so an ecliptic rotation such as Rz(Ω)·Rx(−I)·Rz(F + 180°) becomes Ry(Ω)·Rx(−I)·Ry(F + 180°) in the scene. Since #96 the body frame is the IAU body-fixed frame of the 2015 report for every body but Earth (GMST), at TT for TDB ([Body rotation](#body-rotation-iau-prime-meridians)).
- **One scene frame, the stars included.** The catalogues are J2000: Celestia's stars.dat (and so the asterisms and star labels, placed from it) and the Milky Way and galactic grid (`galacticFrame.js`). They'd sit displaced from the planets by precession, 50.3″ a year in longitude: ~0.37° in 2026, ~28° at year 0 (#133). So they hang under `StellarFrame` (`js/scene/StellarFrame.js`), a group at the Sun (the catalogue is heliocentric) whose rotation is `celestialFrame.precessionQuaternion(J2000, date)`, Meeus 21.5's Rz(Π + p)·Rx(−η)·Rz(−Π), in scene axes.
  - The chain is `WorldGroup` (rebase) → `milkyway` → `StellarFrame` (J2000 → date) → `Stars` (catalogue positions, J2000) → points, labels, asterisms; and `StellarFrame` → `MilkyWay`. The Sun and planets are under `WorldGroup` directly, so the planets, the Moon, Earth's GMST spin, places, and Cesium's camera coupling (built from body node matrices) are untouched. The galactic grid gets the same rotation on top of its own.
  - **Updates:** Animation calls its `preAnimCb` with the Julian Day animated (so `animateAtJD`, e.g. a permalink restore, sets it too). It's rebuilt only when the date moves by more than a day (0.14″ of precession), in place.
  - **Reading star positions:** raw `star.x/y/z` and the stars' geometry are J2000, the `StellarFrame`'s local frame. Take them to the scene with `Scene.starPosition(star)` (the `WorldGroup` frame) or the stars' `matrixWorld` (world space). `goTo(star)` rebases to `-starPosition(star)`, and re-rebases when the frame turns so the star stays at the origin; picking (`Picker.queryPoints`) takes the ray into the catalogue frame instead of rebuilding its tree. The RTE shaders apply the model rotation (see [RTE interaction](#rte-interaction)).
  - **Checked** against JPL Horizons at 1900, 2026 and 2500 (`StellarFrame.test.js`, offline fixture `StellarFrame.horizons.json`): the Moon's separation from reference stars (their catalogue direction) is within 3.1″ of Horizons', and its place among them within 4.3″. Proper motion, parallax and aberration are left out; proper motion over centuries is a separate refinement.
  - **The catalogue's epoch is Hipparcos's, J1991.25**, not J2000 (the equinox is J2000's): Sirius carried back from its J2000.0 place by its proper motion lands 0.003″ from its stars.dat position at J1991.25 and 11.7″ off at J2000 (`gaia/astrometry.test.js`). Gaia's stars (a point population under `Stars`) are stored at J2000.0 with their space velocities and moved to the date in the vertex shader ([Gaia.md, frame and epoch](js/scene/Gaia.md#frame-and-epoch)); the bundled catalogue doesn't move.
  - The equatorial grid and Earth's pole use the J2000 obliquity about the equinox of date, i.e. the mean equator of date to within the change in obliquity (47″ a century). `celestialFrame.precessEcliptic` converts coordinates between dates, e.g. to compare with Horizons' J2000 ecliptic vectors.
- **Supported dates: J2000 ± 6000 Julian years** (JD 260045 to 4643045,
  about 4000 BC to AD 8000; `Time.SUPPORTED_YEARS_FROM_J2000`). The clock
  clamps at the source: `Time` holds the date at a bound rather than run
  past it, `setTime` clamps (and ignores NaN), the time rate is capped at
  2^40 (~35,000 years a second; 2^1024 is Infinity, and Infinity × a
  zero frame delta is NaN), and a permalink's `t=` is clamped on decode
  (a non-finite one makes it invalid). At a bound the rate readout says
  "(date limit)". Why that range:
  - VSOP87C here is the full series (the `vsop87` package), documented to
    1″ over ±4000 years for Mercury to Mars, ±2000 for Jupiter and Saturn,
    ±6000 for Uranus and Neptune. It's a series in powers of time from
    J2000 and diverges beyond: evaluated, it's still plausible at ±8000
    years, puts Jupiter at 7.6 AU at −20,000, thousands of AU out at
    ±100,000 and ~3 × 10⁹ AU (50,000 light-years) at a million years.
    Planets and their lines then agree on garbage: the light-year-sized
    "Lissajous" orbits seen before the clamp.
  - Meeus 47 (the Moon), the IAU 1976 precession, the ΔT polynomials and
    the mean elements' rates are fitted over centuries to a few millennia.
  - A JS `Date` ends at ±8.64e15 ms (±275,000 years); past it the date
    readout showed NaN, while the clock itself stayed a finite number.
- **Time:** the simulation clock is UTC. VSOP87C is fed the UTC Julian Day as it is (69 s of ΔT moves Earth ~2000 km). The Moon moves 0.01° in 69 s, so its series gets TT (`celestialFrame.utcToTtJulianDay`: 32.184 s + the leap seconds since 1972, the Espenak–Meeus ΔT polynomials before, continuous across 1972). So do the mean elements and the IAU rotation models, TT standing in for TDB (within 2 ms; Jupiter turns 0.00002° in it); Earth alone turns with the UTC clock, by GMST ([Body rotation](#body-rotation-iau-prime-meridians)). The UTC Julian Day is `Time.toJulianDay`, with the Unix epoch at JD 2440587.5 exactly (it used to run 14.6 s ahead, ~8″ of lunar motion). After 2017 TT − UTC stays at 69.184 s, right for a UTC clock, but UT1 keeps drifting: Earth rotation for future dates needs UT1 − UTC or a ΔT model.

## Camera Controls

Camera orientation and position are separated across three input modes, all accumulating independently:

| Input | Effect |
|---|---|
| Scroll wheel | Zoom (TrackballControls, asymptotic near surface) |
| Mouse drag | Free look — pitch (up/down) and yaw (left/right) around camera's local axes, slower the narrower the field of view ([FOV-scaled](#fov-scaled-turning)) |
| Option+drag | Orbit — rotates camera as a rigid body around the planet center (position + orientation rotate together), slower the nearer the ground ([proximity-scaled](#proximity-scaled-orbit-drag)) and the narrower the field of view ([FOV-scaled](#fov-scaled-turning)) |
| ↑ / ↓ arrow keys (hold) | Pitch camera nose up/down, slower the narrower the field of view |
| ← / → arrow keys (hold) | Roll camera left/right (while tracking too); not slowed by the field of view |
| `t` | Toggle continuous tracking: the target stays centred every frame, following a place as its body turns, and the roll stays yours ([the target](#the-target)).  "Tracking on" or "off" shows on the readout, and it is a checkbox in Settings |
| `f` | Toggle follow: the camera rides a body's orbit as time runs, and the view stays as it is, so the user can look around from a planet's moving frame.  It is **on after `g` and after landing** (the camera is on the body's orbit), and `f` then turns it off by leaving the body for its frame (a planet's: the Sun's), so the body moves on without the camera; `f` again rides the target ([follow](#follow)).  "Following on" or "off" shows on the readout, and it is a checkbox in Settings.  In the link as the `F` setting ([design/URLs.md](design/URLs.md#view)) |
| `c` | Snap look at current target, squaring the roll to the ecliptic's up |
| `j` / `k` / `l` | Reverse, slow down, speed up time: paused too, when the step is often set; the display shows it and resuming runs at it |
| `-` / `=` (or `+`) | Exposure compensation down / up a third of a stop (EV), over the metered exposure; the readout shows "EV +1.3" for two seconds |
| `[` / `]` | The stars' setting: the limiting magnitude's offset from the naked eye's, 0.5 mag a press (not the exposure); 0 is the default, shown as "Stars +1.0 mag" and in the link as `sm=` ([design/URLs.md](design/URLs.md#view)) |
| Click / tap a label (a star, planet, moon, asterism or place name) | Target it and do nothing else: `c` then faces it, `g` goes ([Picking labels](#picking-labels)) |
| Double-click / double-tap a label | Go to it, as `g` does |
| Double-click / double-tap elsewhere on a body | Land there |

**Touch.** Pinch zooms, through `TouchSafeTrackballControls`
(`js/TouchSafeTrackballControls.js`): TrackballControls with its list of
touching pointers kept right.  As three ships it, it captures only the
first finger, so a second one lifted over HTML (the widgets sheet, the info
panel) never sends it its pointerup; once that pointer ID is reused, every
touch move throws.  The subclass captures every pointer and lists each
once.

**Asymptotic zoom** (`js/zoom.js`): scroll zoom is remapped from distance-space to altitude-space so the camera approaches the surface asymptotically. The `camera.near` plane is dynamically scaled to `altitude * 0.1` (clamped 100 m – `SMALLEST_SIZE_METER`) so the surface remains visible without clipping.

### Proximity-scaled orbit drag

An orbit drag turns the camera about the body's centre by 0.005 rad a pixel, which carries the view over the ground by that angle times `R + alt`. Unscaled, that is 32 km a pixel at 5 km up on Earth, while the screen shows a patch about `alt` across: no way to move a few km over the ground. `rotateScale(alt, R)` (`js/zoom.js`) multiplies the speed by `1 - exp(-alt / R)`, where `alt` is the height over the *ground* (Cesium terrain where a layer knows it, as in zoom) and `R` the radius of the body the camera is at (`homeBody`, as in zoom). `ThreeUI.orbitScale()` supplies it to `dragControls` (`getOrbitScale`), read on every move.

- **Near the ground** it is `alt / R`, so a radian of drag sweeps `~alt` of ground, a similar fraction of the visible patch at every altitude. The exact ratio for that is `alt / (R + alt)`.
- **From a few radii out** it is 1 (0.95 at 3 R, 0.99 at 5 R), so far views drag as they always did. Plain `alt / (R + alt)` would still be slowed by a third at 2 R, so the saturating exponential takes its place: same slope at the ground, no tunables, smooth and monotonic.
- **Never zero**: floored at `MIN_ROTATE_SCALE` (1e-6, a few cm a pixel on Earth), so a drag at the ground still turns the view.
- **Curves ruled out**: a log of altitude is too gentle (kilometres a pixel at 5 km up), and a power above 1 crawls close in and falls out of step with the patch.
- **Only orbit drags are scaled by altitude.** Free-look drag (pan) and the arrow keys (pitch and roll) turn the camera in place and move nothing over the ground, so slowing them by altitude would only keep you from looking about the horizon. The field of view slows them instead, below.

### FOV-scaled turning

A drag turns the view 0.005 rad a pixel and a pitch key 0.01 rad a frame, whatever the field of view. A pixel spans about `fov / heightPx` of sky, so at the default 45° in a 600 px canvas a pixel of drag carries the scene ~4 px, and at a telescope's 0.07° ~2,500: one pixel of drag swings the view hundreds of screens. `fovTurnScale(fov)` (`js/zoom.js`) multiplies the rate by `tan(fov / 2) / tan(45° / 2)`, the ratio of the field's tangent half-angle to the default's (the same ratio as `farPoint.js` `fovScale`), so the scene moves the same number of pixels per pixel dragged at every field.

- **Every drag mode takes it.** `attachPointerDrag` reads `getTurnScale` on each move and uses it for the free-look drag and the orbit drag (mouse, pen and one-finger touch alike: it is one pointer handler), and `_applyCameraArrowKeys` for pitch. An orbit drag multiplies it with [rotateScale](#proximity-scaled-orbit-drag), which it does not replace: the proximity scale makes a drag worth the same share of the ground a view of height `alt` shows; this one the same share of a view whose height is `alt * fov`.
- **Exactly 1 at 45° and wider**, so those views turn as they always did. It is capped at 1 (not raised for wide fields): a wide field isn't what makes a drag hard to steer, and the tangent ratio at 170° is 28. Floored at `MIN_ROTATE_SCALE` (1e-6).
- **The canvas height drops out.** The rate is already per pixel, and a pixel's angle is `2 tan(fov / 2) / heightPx` at any height, so only the ratio of fields matters; a height term would change the 45° rate on every window but the one it was tuned at. (Measured in headless Chromium, 640×404, a 20 px drag: the surface point under the middle of the view moved 48.4 px (pan) or 26.4 px (orbit) at 45° and 48.3 and 26.4 at 0.07°.)
- **Roll isn't scaled.** It turns about the view axis, so the picture moves by the same pixels at any field.
- **Zoom steps were already proportional.** `,` and `.` multiply the field by exactly 0.9 and 1.1 (`multFov`); the wheel and pinch (TrackballControls) dolly the camera by a factor of its distance, not the field, and don't read it.

**Camera platform**: the camera is a child of `camera.platform`, a scene-root `Object3D` reparented on each `goTo()`. For planet targets the new parent is `obj.orbitPosition` so the camera tracks orbital motion automatically; for star targets it's `_starAnchor`, a dedicated scene-root anchor at world origin (paired with a `WorldGroup` rebase that moves the target star to origin). See [Navigation (goTo flow)](#navigation-goto-flow) for the full flow.

**Navigation tweens** (`js/camera.js`) — stays at root as general infrastructure:
- `newCameraLookTween` — 600 ms quaternion slerp used by `setTarget` (key navigation, `'c'` key)
- `newCameraGoToTween` — 1800 ms unified tween used by `goTo`; rotation runs 0–60%, position 40–100%, with a 40–60% overlap so the camera never stops between turning and traveling. Details in [Navigation (goTo flow)](#navigation-goto-flow).


### Follow

`f` makes the camera ride a body's orbit: it moves with the body as time runs, and the view's orientation is not touched, so the user can look around from a planet's moving frame (a Sun-frame camera watching Jupiter goes round the Sun with it, or a camera at Earth rides the Moon's orbit).  `t` is the other half, and independent: tracking only turns to face the target, following only moves with it, and both together ride along while facing it.

**How:** following hangs the camera platform on the followed body's `orbitPosition`, the node the animation moves, keeping the camera where it is and as it faces in the world (`rehangPlatform`, `js/follow.js`).  After that the scene graph carries the camera, as it does after a `goTo`, with nothing to do per frame and no error to accumulate.  `Scene.syncFollow()` does the hanging, once a frame in Celestiary's animation callback, after the animation has put the bodies at this frame's positions, so the camera's offset from the body is that of the frame about to render (and before the tracking look, so tracking faces the target from where the camera now is).  It compares a few references and returns when there's nothing to do.

*Why not add the body's motion to the camera each frame:*
- translating `camera.position` leaves the zoom and the orbit drag about the frame body (the controls' target is the platform's origin), so a Sun-frame camera 4e8 m from Jupiter would zoom in steps of a tenth of its 7.8e11 m from the Sun;
- translating the platform breaks `controls.target = platform.position`, which holds the platform at the origin of its parent;
- both would keep the camera's coordinates large in the Sun's frame (7.8e11 m, so millimetres of double rounding, summed each frame), where hung on the body the camera's position is its offset from it (4e8 m), the frame-local numbers `goTo` already works in.

Hung on the body, the zoom and the orbit drag are about the body, and `homeBody` (the floor of the zoom, the near plane) takes it as the camera's body: `syncFollow` sets `Shared.targets.cur` to it, which is also the frame the link's position is in.  Everything in a frame is relative to its node, so leaving a body is the same operation the other way.

**The state is what the camera does.**  Going to a body or landing on it (`Scene.goTo`, `land`) hangs the platform on that body's orbit, so the camera rides it, and that is following: it is **on** after them (`Shared.targets.follow` holds the body's `orbitPosition`; the readout says "Following on", Settings ticks it, the link gets `F`).  It was once off after a go, while the camera rode the body all the same, which put the flag and the picture at odds.  A go to a star is off: a star has no orbit.

**`f`:**
- *Following, camera on the followed body* (after `g`): off, by **leaving it**.  The platform is hung on the body's frame, with the camera where it is and as it faces (`rehangPlatform`): a planet's is the Sun's, a moon's its planet's (`props.parent`).  The body then moves on without the camera, which stays still in that frame.  `Shared.targets.cur`, and so the zoom, the orbit drag and the link's frame (`from=`) and position, are the new frame's.
- *Not following*: on, for the target.  The platform moves to the target's node (the Sun's frame with Jupiter targeted: the camera rides Jupiter without a jump) and the frame it came from is kept (`_followHome`), so `f` off returns to it rather than to the body's primary.
- *At the Sun*, or landed: it can't turn off.  The Sun has no frame above it (the root: following it is staying still, so there is nothing to leave), and a landed camera is pinned to the surface (`g` or a search leaves it).  Following stays on and the readout says why ("Following on (nothing above the Sun to leave)").  Two ways round: at the Sun with another body targeted, `f` rides that body instead (this is how to ride Jupiter from the Sun's frame), and `f` again goes back to the Sun's frame; and with a `_followHome` (the Sun ridden from a planet's frame) it goes back there.

**Interactions:**
- *Going and landing.*  They hang the platform themselves and turn following on for where they go.  A tween that moves the camera in the platform's frame (`newCameraGoToTween`, `newCameraLandTween`, marked `tween.travels`) would be moved under by a re-hang, so `syncFollow` waits for it and, when it ends, carries on from wherever the camera got to (the look tween only turns the camera and doesn't wait).
- *Landed* (`Shared.targets.landed`): the camera is pinned to the body's surface and `syncFollow` moves nothing; a camera at a star (`_starAnchor`) has no body to ride either.
- *The target changes while following:* **nothing**: the body followed is the one the camera is on, however the target moves, so looking at another body (a click on a label, `u`, `1`-`9`) doesn't take the camera with it.  `f` off and on again follows the new target.  (Following the target as it changes, as tracking does, was tried: after every `g` a click on another label moved the camera to that body's orbit.)
- *Link:* see below.
- *The readout:* `Scene.onModeChange('follow' | 'track', on, note)` goes to `Celestiary.onNavMode`, which the exposure readout shows ("Following on", `js/navMode.js`); a restored link says nothing for what going there sets, only when the link doesn't follow.

**Link.**  `F` means the camera follows **its frame's body**: the link's `from=`, else the path's body.  Going or landing is following, so a link made after `g` is `sun/earth@…;s=F`; a link made after `f` has left the body is in the Sun's frame, with `from=sun` and no `F`.
- *Restore* (`Celestiary._arrive`, `Scene.restoreFollowing`): the camera is put in the frame as the link says, and following is on if the link has `F` **or the frame is the target's own body** (no `from=`, or the same one).  That second case is every link from before `F`, which always rode its frame body, so old links keep their meaning and show "following".  A frame that isn't the target's body, without `F`, is detached.  The camera isn't moved by either.
- *What it can't say:* a camera in the target's own frame that has left a different body (the Moon's, then `u` to Earth: frame Earth, target Earth) reads back as following Earth: the picture is the same, and one more `f` leaves it.  And the position of a camera in the Sun's frame is written to four decimals of a degree: 260 km at 1 AU, where a camera on the body keeps a few metres.
- *Riding from another frame:* the link writes the camera's frame (`Shared.targets.cur`), which following makes the followed body's: a link made while riding Jupiter is `sun/jupiter@…;s=F`, the position the offset from Jupiter.


## Navigation (goTo flow)

`Scene.goTo(star)` reorients the camera onto a new target body. It has to satisfy two
competing pressures:

- **Float32 precision.** At star-scale distances the camera's world coordinates cannot
  be large — catastrophic cancellation in `(objWorld − cameraWorld)` would destroy
  positional accuracy for any non-RTE object.
- **Smooth transitions.** Users expect a visible "turn then travel" beat that animates
  from wherever the camera currently is toward the new target.

The design resolves both by rebasing the universe so the new target sits at world
origin, keeping camera world coordinates small, while preserving the camera's *position
within the `WorldGroup` frame* so the subsequent look + travel tween has meaningful
start and end poses.

### Anchors

The camera platform is parented differently depending on target type:

| Target | Parent after `goTo()` | Notes |
|---|---|---|
| Planet / sun | `obj.orbitPosition` | That group is what orbital animation writes into, so the camera follows the body's orbit automatically. |
| Star (catalog entry) | `_starAnchor` | A scene-root `Object3D` permanently fixed at world `(0, 0, 0)`, paired with `worldGroup.position = -scene.starPosition(star)` (the catalogue position precessed to the date) so the target star lands at world origin. |
| Galaxy (SPARC) | `_starAnchor` | As a star: its catalogue position rebased to the origin, arriving at its `viewDistance`; the zoom eases toward its core (`Scene.galaxyHome`) ([Galaxies.md](js/scene/Galaxies.md#levels-of-detail)). |

### goTo flow

Six synchronous steps before any tween runs:

1. Capture pre-rebase camera world pos, world quat, and `wgOld = worldGroup.position`.
2. Rebase `worldGroup.position` to `(0, 0, 0)` for planet targets or
   `-scene.starPosition(star)` for star targets.  While a star is the target, the
   rebase follows it as the `StellarFrame` turns.
3. Compute `wgDelta = worldGroup.position − wgOld` and shift the captured camera world
   pos by `wgDelta`. (See Invariant below.)
4. Reparent `camera.platform` to the new anchor and reset its local transform to
   identity.
5. Restore the shifted camera world pos (via `platform.worldToLocal`) and reconstruct
   `camera.quaternion` so the camera's *world* orientation matches what was captured
   in step 1.
6. Compute the arrival pose (a point at `radius × STEP_BACK` along the camera→target
   line) and start a single `newCameraGoToTween`.

### Invariant

Across `goTo()`, the preserved quantity is **camera position in the WorldGroup frame**
(`camera_world − worldGroup.position`), not camera world position. Camera world
position deliberately shifts by `wgDelta` so the camera "moves with the universe":

- When camera is already under `WorldGroup` (via some planet's `orbitPosition`), this
  happens automatically because its parent moved during the rebase.
- When camera is under `_starAnchor` (scene-root, unaffected by the rebase), step 3
  applies the shift manually.

Without the shift, star → star travel collapses to zero distance (camera and the new
target both sit at origin because the old target was already at origin and `_starAnchor`
didn't move). Pressing `h` from any star also produces an identical "instant look back"
with no rotation animation, because the camera was coincidentally still pointing at
origin after the rebase moved the sun into origin.

With the shift, the direction from the (shifted) camera to the new target encodes where
the user started from, so the follow-up rotation depends on the starting body.

### Split-timing tween

`newCameraGoToTween` is a single 1800 ms tween with two independently eased channels:

| Channel | Active | Eased |
|---|---|---|
| Rotation (slerp to `lookAt(target)` from arrival) | 0 – 60% (0 – 1080 ms) | quadratic in-out |
| Position (lerp from start to arrival) | 40 – 100% (720 – 1800 ms) | quadratic in-out |
| **Overlap** | **40 – 60% (720 – 1080 ms, 360 ms)** | both active |

The overlap means the camera starts moving before it finishes turning — there is no
frame between the two phases where nothing is animating.

### Approach

Every planet and moon is gone to by one path, from the target switch to
the arrival, and it diverges only where the surfaces do (a Cesium layer,
an atmosphere, rings).  What a body looks like on the way is four things,
each the same for all of them:

| Stage | What | Where |
|---|---|---|
| Target switch | `setTarget` keys the exposure to the body (its distance from the Sun) and asks for its surface (`preloadNear`, served next frame), for a moon its planet's too, so its maps load while the camera turns | `Scene.setTarget`, `Planet.preloadNear` |
| Exposure on the way | `goTo` hands the UI the travel (`ThreeUi.approach`): from the arrival pose it works out the gain the meter will settle on there (the sunlit-disc anchor of the body and whatever else that frame holds, over an otherwise dark frame: `exposure.js arrivalGain`), and each frame of the travel renders at the exposure without the travel blended to the arrival's, evenly in stops, by the position channel's eased progress (`approachExposure`, `tween.travelProgress()`).  On arriving the meter is handed that gain; readings of frames drawn on the way don't set its goal | `ThreeUi._approachStep`, [HDR.md, travel](js/scene/HDR.md#travel) |
| LOD hand-off | the far point's light goes over to the disc's within 4× of the distance where the mesh takes over (`farPointLevel`), the small disc draws a few pixels at their coverage and writes the sphere's depth (so the atmosphere pass draws its sky over it), and the full mesh takes over at 24 px, all at the same exposure | [the far point](#the-far-point), [Planet.md, small discs](js/scene/Planet.md#small-discs) |
| Surface before its maps | one-texel stand-ins (the colour map's mean over the sphere, a flat normal) until each map is in, so a slow map never leaves the body missing or black | `standInMaps.js`, [Planet.md, while the maps load](js/scene/Planet.md#while-the-maps-load) |

Before, the exposure was the meter's alone, and the destination is a few
pixels across until the last few frames of a travel, too late for a meter
that eases up with a 1.5 s time constant: from the Sun's view (the meter
stopped down for its disc) Mars arrived at 1/30 of its settled brightness
and took 3 s to come up; from a star field (dark adapted) Earth arrived
at 2,000-4,000 times its exposure, white, and the Moon too.  An approach
interrupted (another tween, a link restored) just ends, and the exposure
eases back to the meter's from where it was.  A landing (`newCameraLandTween`)
and a travel to a star keep the meter's exposure.

### RTE interaction

Stars, asterisms, and catalog star-name labels use Relative-To-Eye shaders that compute
camera-relative positions every frame from double-precision emulation (high + low
float32 split). They are visually stable across a `WorldGroup` rebase: the uniforms
update one frame, the rendered positions on screen don't change.

The camera uniforms are the camera's position in the drawn object's own frame,
`rte.js`'s `rteCameraLocal`: Rᵀ·(camera − t) from the object's `matrixWorld`.
The shaders turn the eye-relative vector by `mat3(modelViewMatrix)`, so a parent
rotation (the `StellarFrame`'s precession) reaches the GPU; the translation stays
out of float32.  An RTE object must live in the frame its positions are in (the
picked-star label is a child of `Stars` for that reason).

Non-RTE objects — the sun and planet meshes — are ordinary Three.js objects under
`WorldGroup`, so they *do* visibly teleport when the rebase shifts their world
positions. This teleport is the visible "warp" of star navigation: planets jump,
stars hold still.

### `setTarget`, `lookAtTarget`, `'c'` key

Out of scope for the goTo flow. These use `newCameraLookTween` (rotation-only, 600 ms)
and do not rebase or reparent. They only change `camera.quaternion` while leaving the
scene graph alone.

The search bar's Look at button is a caller of this path: `setTarget` of the result, the
tween aimed at a body, a star's world position or a surface point.  See
[js/search/DESIGN.md](js/search/DESIGN.md#go-and-look-at).

### The target

One target, shown and used everywhere: what the breadcrumb shows, what the
link's path names, what `c` faces, `g` goes to and `t` tracks.  It is a body,
a place on one, a catalogue star, an asterism, one of SPARC's galaxies
(`{kind: 'galaxy', galaxy, name}`, [Galaxies.md](js/scene/Galaxies.md)) or an
Earth satellite (`{kind: 'satellite', id, name, body: 'earth'}`, Earth the
`obj` as for a place: [Satellites.md](js/scene/satellites/Satellites.md#in-the-scene)), and **`Scene.setTarget` is
the only way it changes**: a click on a label, a pick in the search, Look
at, Go, the keys (`h`, `u`, `0`-`9`), `Scene.goTo` and `Scene.land` (each
makes where it went the target; a landing at a place keeps the place), and
a link.  `setTarget(target, {look})` takes a body's name or a target as the
labels carry them (`{kind: 'place', body, name, lat, lng, alt}`,
`{kind: 'star', star, name}`, `{kind: 'asterism', name, position}`); it never
moves the camera, and turns it only with `look` (the default, for the keys
and Look at; a click passes `look: false`).  It sets:

| State | For |
|---|---|
| `Shared.targets.obj` | the targeted body, or a place's body (kept for a star or an asterism) |
| `Shared.targets.label` | a place, star or asterism; null for a body.  `c` (`lookAtTarget`), `g` (`Celestiary.goTo`) and `t` read it first |
| the store's `committedTarget` (`setCommittedTarget`), with `committedPath` and `committedStar` as views of it | the breadcrumb (Sun › Earth › Austin; a star's or asterism's name alone), the info panel, the page title |
| `onTargetChange` → `Celestiary._schedulePermalinkUpdate` | the link: its path is the target (`js/targetPath.js`, [design/URLs.md](design/URLs.md#path)) |

Nothing else writes those, so the breadcrumb, the link and `t` can't
disagree.  `Scene.getTarget()` reads it back.

The camera's frame is separate: `Shared.targets.cur`, the body its platform
hangs from (or the star it went to), set only by going and landing.  The
link's position and `cq` are in that frame, named by `from=` when it isn't
the target's, so targeting rewrites the link's path and not its view, and
the new link reloads to the same view
([js/permalink.md](js/permalink.md#the-cameras-frame)).

`t` turns tracking on and off (`Shared.targets.track`): every frame,
after the animation, the camera turns to centre the target.  A place is placed on its
body that frame, so tracking follows it round as the body turns; a body
along its orbit; a star or an asterism holds still.  Changing the target
while tracking tracks the new one.

**Tracking centres the target and leaves the roll free.**  It used to
call `camera.lookAt`, which squares the view to the scene's up every call
and so locked the roll: whatever the user rolled the camera to (the arrow
keys, the trackball) was undone the next frame, and to find a moment by
running time forwards and backwards with the target centred, the user had
to turn tracking off and re-roll by hand.  `lookAtTarget({keepRoll: true})`
(`faceKeepingRoll.js`) turns the camera by the shortest rotation that
brings the target to the view axis, about an axis square to both the old
and the new view, with no twist about the view axis: the roll is whatever
it was.  Seen against the ecliptic's up it drifts a few degrees as the
target crosses the sky (the turn carries the frame along, parallel
transport), and returns as time runs back over the same path; it is never
forced to a value.  `c` still squares the view (`lookAt`).  While
tracking the roll arrow keys work and pitch is left out (it would fight the
centring); a pitch or yaw drag is undone by the next frame, a roll is kept.

### The target's label

A star that is the target carries its name in the scene, whatever its
magnitude (`js/scene/TargetLabel.js`).  The catalogue's label sheet
(`Stars.showLabels`) has only the named stars and the very luminous ones
(absolute magnitude under -5), so a faint star found in the search (HIP
46635, V 8.4, next to Jupiter) had no label at any magnification, and the
sheet is hidden with `l` anyway.  `Scene.setTarget` records the star
(`Stars.setTargetStar`: no DOM work in the call), and `Stars.preAnimCb`
builds a one-label sheet in the stars' frame when it is first wanted, hides
it, or drops it when the target is not a star (the Sun has its own label).

It is drawn while **any label group is on**, `l` (stars) or `p` (bodies and
places), so the user who hid the other stars' names to see one still sees
the target's, and `V` (presentation mode, which turns both off) hides it.
When `l` is on and the catalogue's sheet already names the star, that
label is the one drawn, not a second on top (`targetLabelShown`).  It is on
the overlay layer like the others, outside the star's magnification: a
label is a fixed number of pixels, so at a telescope's field it sits at the
star's position, text above it.  A letter in `s=` is a flip of its default
(`l` and `p` are on by default), so `s=loL` is star labels off, orbits off,
landed.

### Picking labels

One model for every label, on the canvas and in the search: **a click or tap
targets what the label names and does nothing else; a double click or tap
goes to it.**  The camera doesn't move or turn on a click, so `c` (face it)
and `g` (go) are the next step, as for any target.

The hit test is one for all of them (`js/scene/labelPick.js`).  A label sheet
that can be picked carries `userData.labelTargets`, what each label is of, by
label index; `labelBoxes` projects the visible sheets' labels to their text
boxes on screen, and `hitLabel` takes the one under the pointer (8 px of
slop; the nearest centre, then the nearest the camera).  A sheet of surface
labels (the places) also carries `userData.labelBody`, so the far side of
the body, where the shader discards them, isn't hit.  It's off while the star
picker is on, whose own double click picks a star.  A click on a body's disc
or on empty sky does nothing; a double click on a body's disc still lands
there.

A click is `setTarget(label, {look: false})` for every kind ([the
target](#the-target)): the breadcrumb, the link and the info panel follow,
the camera stays.

| Label | Target (a click): breadcrumb, link path | Go (`Celestiary.goToLabel`, a double click, and `g`) |
|---|---|---|
| Planet, moon, Sun (`kind: 'body'`) | Sun › Earth › Moon, `#sun/earth/moon` | the body's path in the hash, as search Go |
| Star (`'star'`) | Sirius, `#hip:32349` | `scene.goTo(star, name)` |
| Place (`'place'`, on a body) | Sun › Earth › Austin, `#sun/earth/austin`; its body is `Shared.targets.obj` | `scene.land(body, lat, lng, alt, {target: place})`: the camera lands there at the catalogue's altitude, or `DEFAULT_LAND_ALT_M` (eye height) without one, and the place stays the target |
| Asterism (`'asterism'`, named at the centroid of its stars) | Ursa Major, `#asterism:ursa-major` | `lookAtLabel`: the look tween toward the centroid, no travel (it's a direction, with nowhere to arrive) |

An asterism's name sits at the mean direction of its
stars from the Sun, at their mean distance (`Asterisms.centroid`), and is
shown with the lines (`a`).

dragControls fires `onClick` on both clicks of a double and then
`onDblClick`, so a double click targets, then goes; nothing conflicts.  It's
pointer events throughout (a tap is a click, two taps within 350 ms and 8 px
a double), so touch needs nothing of its own; `TouchSafeTrackballControls`
keeps the second finger from breaking the first's pointer ID.

The search bar follows the same model: picking a result in the dropdown
targets it (`targetEntry`), leaving the bar open; Look at targets it and
turns to it; Go and Enter travel
([js/search/DESIGN.md](js/search/DESIGN.md#picking-a-result-and-the-breadcrumb)).


## Rendering Techniques

| Object | Technique |
|---|---|
| Star field (~120k stars) | Custom GLSL shader on `Points` geometry; size/brightness from magnitude |
| Milky Way | Its integrated light: a full-screen pass at the far plane that ray-marches a published structural model (discs, bulge and bar, arms, dust) in the galactocentric frame, into a cached target re-marched when the view moves by more than it can show, less the light the star catalogue draws as points round the Sun; the atmosphere pass draws it with the rest of the night sky's light (the zodiacal light, airglow) through the eye's response to extended light ([MilkyWay.md](js/scene/MilkyWay.md), [HDR.md](js/scene/HDR.md#the-eye-and-extended-light)) |
| Other galaxies (SPARC's 175) | The Milky Way's model with each galaxy's own parameters, in exposure units at three levels of detail: a point carrying its integrated light (as a star's, dimmed by its dust at the angle it's seen at), an impostor (its orthographic march, cached) once it's larger than the eye's patch, and the full perspective march near it ([Galaxies.md](js/scene/Galaxies.md)) |
| Star discs (the Sun, and any catalogue star travelled to) | A photosphere from physical parameters: temperature from class, blackbody colour and luminance, limb darkening by temperature, granulation at three scales, spots and faculae ([js/scene/Stars.md](js/scene/Stars.md)) |
| Planets | `MeshStandardMaterial` with optional diffuse, bump, normal (the Moon's relief, [Planet.md](js/scene/Planet.md#relief)), hydrosphere, and cloud textures; a few pixels across, antialiased and shaded per fragment as the sphere ([Planet.md, small discs](js/scene/Planet.md#small-discs)) |
| Earth's clouds | A shell 6 km up on its own layer, drawn after the Cesium composite so it covers both sides: the date's NASA GIBS true colour unmixed into coverage, Lambert-lit in exposure units, shadowing the ground ([Planet.md, clouds](js/scene/Planet.md#clouds)); below 30 km over the deck a ray-marched cloud layer seeded by the same map takes over, at half the frame's size with temporal reprojection, lit by Mie scattering (a tabulated phase function), the delta-Eddington field of the local column for its multiple scattering, the Sun through the air's transmittance and the sky's Ψ, composited by the atmosphere pass in the air ([atmos/clouds.md](js/scene/atmos/clouds.md)) |
| Atmospheres | Fullscreen post-process pass over the scene buffer: Bruneton LUTs, the sky in exposure units, then the one tone map ([composition.md](js/scene/atmos/composition.md)); one body's air, the one the camera is in, else the target's ([which body's air](js/scene/atmos/composition.md#which-bodys-air)) |
| Saturn rings | Double-sided `RingGeometry`, lit in exposure units as a slab of particles scattering the Sun's light once (`ringPhotometry.js`): the colour map the particles' albedo, the opacity map their optical depth, calibrated to the rings' integrated light ([rings.md, lighting](js/scene/rings/rings.md#lighting-the-rings-in-exposure-units)) |
| Orbit paths | A wide line strip (`wideLines.js`, 1.5 px, additive, on the overlay layer after the atmosphere): the body's sampled path, or its mean-element ellipse ([Orbit lines](#orbit-lines)) |
| Labels | Canvas-rendered `SpriteSheet` compiled to a single `Points` geometry |
| Asterisms | Wide lines (`wideLines.js`) between the stars of `asterisms-clean.dat` |
| Human expansion | Wide lines (`wideLines.js`), one per hop of a BFS across the catalogue, grown in the shader by a time uniform ([Colonization.md](js/scene/Colonization.md)) |
| Wide lines (`wideLines.js`) | Instanced screen-space quads: any width, antialiased, cut in front of the camera, divided through to w = 1.  Segments (RTE, optionally sorted far to near: the asterisms, the human expansion) or a strip (a Line's position attribute and draw range, through the model-view: the orbits).  GL lines are 1 px, and at light-years their w ~1e17 m ([Colonization.md, Drawing](js/scene/Colonization.md#drawing)) |

LOD (`THREE.LOD`) is used throughout to swap between detailed meshes, point sprites, and invisible placeholders based on camera distance.

### HDR pipeline

One linear brightness scale, one tone map ([js/scene/HDR.md](js/scene/HDR.md), #86):

| Pass | Target | Holds |
|---|---|---|
| Scene | `_sceneRT`, RGBA16F | lit surfaces × the exposure the frame renders with (the target-keyed exposure × the metered gain × the user's exposure compensation, 2^EV: [HDR.md](js/scene/HDR.md#user-exposure-compensation); exposure-only tone mapping); emitted sources (the stars, the Sun's disc and glow) × the same gain before the buffer, pre-exposed (`hdr.js` `absoluteUniforms`; [HDR.md, pre-exposure](js/scene/HDR.md#pre-exposure)), with nothing under half-float's smallest normal value; display-referred content (a body's far point) through the inverse of the final tone map (`hdr.js` `sceneReferred`) |
| Cesium layers | `_cesiumRT` (8-bit) → `_sceneRT` | each body's Cesium frame (stored × Lambert, one path for every body), decoded into exposure units; its terrain distance (in alpha, `cesium/distance.js`) becomes depth, from below 20 km |
| Atmosphere | screen | `PBR Neutral(sky + scene × T)`, the sky in exposure units, with the volumetric clouds composited in the air where they are drawn ([atmos/clouds.md](js/scene/atmos/clouds.md)); over it, in display values, the night sky's own light (the galaxy's march, the zodiacal light, airglow, through T) by the eye's response to extended light, while the meter reads it as light ([HDR.md, the eye and extended light](js/scene/HDR.md#the-eye-and-extended-light)) |
| Overlay | screen | display values (labels, orbit paths, asterism and expansion lines, grids, the pick marker: `shared.js` `overlay`), after the exposure meter's readback, depth-tested against the scene |

Without float render targets (`EXT_color_buffer_float`), or with `?hdr=0`, the old LDR order: an 8-bit `_sceneRT` tone-mapped in the scene pass, and the sky added in display space.

### The far point

A planet or moon is a mesh out to `POINT_AT_RADII` (500) radii and a
single point beyond (the `planet LOD`'s second level, `js/scene/farPoint.js`,
`Planet.newPlanet`).  The point is a marker, not a lit surface:

- **By apparent size, so the FOV counts.**  500 radii is 1.6 px across at a
  45° FOV over 640 px.  three's `LOD` picks a level by `distance /
  camera.zoom`, which ignores the FOV, so a body zoomed on by narrowing the
  FOV (which moves nothing: Look at Jupiter from Earth, then 1°) stayed a
  point however big it drew.  The planet and label LODs are `FovLOD`
  (`farPoint.js`): the distance is scaled by `fovScale(camera)`, the
  tangent of the half-FOV over its value at 45° (`INITIAL_FOV`), so a body
  switches where it has the same size on screen.  1 at 45°, so the choices
  there are unchanged; 0.021 at 1° (the mesh out to ~24,000 radii, which is
  1.7e12 m for Jupiter); more than 1 wider than 45°.  `CesiumLayers` scales the
  distance the same way against `meshRange`.  The planet LOD is scaled by
  the canvas too (`FovLOD({drawnSize})`, `meshReach`): the mesh until its
  disc is smaller than the point (2 CSS px), never nearer than 500 radii,
  and a few pixels across it's drawn antialiased and shaded as the sphere
  ([Planet.md, small discs](js/scene/Planet.md#small-discs), #192).  Not
  scaled: the stars' LODs
  (`Star`, `Stars.labelLOD`), whose distances are not a size threshold,
  and the places' own pixel-based LOD, which already reads the FOV.

- **Colour and size.**  A planet's is white and 2 px; a moon's is half
  brightness and also 2 px, since many sit by their planet's.  The
  colour is a *display value* (`farPointColor`): the scene is drawn
  unencoded (`outputColorSpace` is linear, `ThreeUI.initRenderer`), so a
  hex colour like `0x808080`, which three reads as sRGB and converts to
  linear, came out at 22%, not 50%, and a lone 1 px dot at 22% is lost
  among the stars.  `size` is in CSS px (three multiplies it by the
  renderer's pixel ratio), so it stays at least one drawn pixel at any
  display density.
- **The hand-off to the disc.**  Within `POINT_HANDOFF_RANGE` (4) times
  the distance where the mesh takes over, the point's level goes from the
  marker's to the light the disc will show there, spread over the point's
  pixels (`farPointLevel`: the brighter of the colour map's mean,
  `textureMeans.json`, and the body's albedo, which is nearer for Earth,
  whose disc is mostly its sky's light, lit as a Lambert sphere at the body's phase and the frame's exposure,
  through the tone map with the rim's pixels at their coverage;
  `Planet.handOffFarPoint`).  So the two carry the same light where they
  swap: Mars at its exposure went from a white 2 px marker (3.75 summed)
  to a disc of 0.5, seven times dimmer, as it was approached.  Farther
  out it is the marker as before.  A body with no colour map keeps the
  marker throughout.
- **Not tone mapped** (`toneMapped: false`): the exposure follows the
  targeted body (~1e-17 far out), which drew the marker black (#85).  The
  colour is a display value, so it must be made with `point()`
  (`shapes.js`), not `new Points`: `point()` is where, under the HDR
  pipeline (#141, HDR.md), a display-referred material is wrapped
  (`sceneReferred`), which keeps it the same through the final tone map,
  whose toe would otherwise darken a dim marker.
- **Depth.**  Depth-tested, no depth write, in the scene pass: three draws
  transparent objects after the opaque ones, so the planets' meshes are in
  the depth buffer by then, and a moon behind its planet is hidden.  It
  writes none, so points don't hide one another (and a body has no mesh
  where its point is drawn).  `depthTest: false` was how it began, which
  drew a point over whatever was nearer.  It stays in the scene pass, not
  the overlay one the labels use, so the atmosphere pass treats it as it
  does the stars: a bright day sky hides it.  In the overlay pass it drew
  over the day sky.
- **Depth precision.**  The depth buffer is 24-bit and standard (near is
  `dynamicNear`, at most 6e5 m; far is 6 galaxy radii), so its resolution
  at a distance z is about z² · 6e-8 / near: ~1e7 m at 1e10 m, ~1e8 m at
  3.5e10 m.  That's enough to hide a Galilean moon behind Jupiter's disc (it's
  at least 4e8 m behind the centre) while Jupiter is a mesh (out to 3.5e10
  m).  Where it runs out (the camera near a surface, where near shrinks to
  100 m, looking far), equal depths pass the test (`LessEqual`), so the
  failure is a point showing that should hide, never one hidden that
  should show; and points far beyond everything sit at the cleared depth
  (1.0), which they pass.  A logarithmic depth buffer would fix the
  precision, but changes the atmosphere pass's depth linearisation and
  the Cesium layers' depth blits, so it isn't worth it for this.
- **Cesium.**  A body drawn by its Cesium layer has no celestiary mesh in
  the scene pass (`CesiumLayers._hideSurface`), so no depth there: a point
  behind it is drawn, and then covered by Cesium's opaque globe, which
  composites over the scene after.  A point *in front of* a Cesium globe
  (the Moon's, in a lunar transit seen from beyond it) is covered too,
  which the old `depthTest: false` did as well.  Drawing it after the
  composite would fix that; the ground-sphere depths the composite
  writes are there to test against.
- **Not in the `V` groups.**  Bodies aren't annotations; the far point
  stays with the body.

### Cesium layers

Near Earth, a Layers control (`js/ui/LayersButton.jsx`) offers a Cesium
"data view" in place of celestiary's own Earth: Cesium runs in the page
against a shadow WebGL context, and its GL calls replay into celestiary's
scene render target through a stencil of the Earth's silhouette
(portal-netgl's same-page link).  Camera and sunlight are coupled so the
globe sits and is lit exactly where celestiary's would be.  Design, data
sources and phases: [CESIUM.md](CESIUM.md).

## Overlays & visibility groups

Every visual feature in the app must opt into one of two top-level
visibility groups so the user has predictable global hide/show controls:

- **`v`** (lowercase v key) — **HTML chrome**: nav panels, search bar,
  time/target HUD, settings dialogs.  React/MUI overlays only — anything
  rendered outside the WebGL canvas.
- **`V`** (Shift+v key, "presentation mode") — **scene annotations**:
  everything drawn into the WebGL scene that isn't a celestial body or
  texture.  Labels, asterism lines, orbit ellipses, reference grids,
  surface place labels, etc.  A second `V` press restores the prior
  per-element state (snapshotted on first press) so users can flip
  between "bare" and "annotated" views without losing their
  per-element toggles.

Each scene-annotation feature also has its OWN scoped lowercase toggle
(`a` asterisms, `p` planet+moon+place labels, `s` star labels, `e` galaxy
labels, `E` globular-cluster labels, `o` orbits, `;` equatorial grid, `x`
human expansion lines, etc.).  `V` is the union
of all the lowercase scene-annotation toggles.

**When adding a new visual feature, decide which group it belongs in and
wire it through the corresponding toggle method.**  Surface place labels,
for example, live under the `p` group: their visibility is controlled
inside `Scene.togglePlanetLabels` alongside the planet name LODs, so the
single 'p' shortcut and the global 'V' both pick them up automatically.

Failing to opt in means the user has no way to hide the new element
short of reloading the page — and `V` (presentation mode) won't be
truly bare.

### Fades

Every overlay fades on and off rather than switching, by its key, by
Settings, by `V` and on the first load ([#238](https://github.com/celestiary/web/issues/238)).
One helper, `js/scene/fade.js`:

- **A `Fade` per group** (`Scene.fades`, by setting key, `OVERLAY_KEYS`:
  `o` orbits, the solar wind and the target's Lagrange points, Hill
  spheres, synchronous orbits and orbital regimes
  ([Lagrange.md](js/scene/Lagrange.md)),
  `p` bodies' and places' names and the
  lat/lng marker, `l` star names, `a` asterisms, `e` `c` `g` the grids,
  `G` galaxies' names, `x` the expansion lines).  Its opacity is
  smoothstep-eased over `FADE_MS` (400 ms) and lives in one shared uniform,
  `uFade`.
- **The group's materials multiply by it.**  `fadeMaterial` wraps a
  material's fragment `main` at compile time, as `sceneReferred` does and
  after it: `gl_FragColor.a *= uFade` under an alpha blend (every overlay's:
  normal transparent or additive), the whole colour otherwise.  So it
  composes with whatever the material already does: the declutter's
  `shown`, the galaxy labels' magnitude gate, the places' tiers, a line's
  own `uOpacity`, the Cesium swap's layer fades.  The overlay pass draws
  after the tone map, so the multiply is in display values.  `fadeObject`
  wraps a subtree; the group's nodes are wrapped when they join it
  (`Scene._joinOverlay`) and again on each step of a fade, so a node built
  mid-fade (a tier of places) takes it.
- **`visible` is the group's drawn state:** true from the start of a fade
  in (at opacity 0) to the end of a fade out, false otherwise, so a hidden
  group isn't drawn at all (`Scene._showOverlay`, the Fade's `onShow`).
- **Stepped once a frame** by a `FadeDriver` (`Scene.overlays`, ticked in
  `Celestiary.frame` from the animation callback).  With no fade moving it
  returns at its first line: a steady scene costs one multiply per overlay
  fragment and nothing on the CPU.  A test or probe that wants the end
  state calls `scene.overlays.finish()`.
- **The target star's label** is in two groups (`l` and `p`,
  TargetLabel.js): `Stars.syncTargetLabel` sets its own uniform each frame
  from the groups that show it.
- **The chrome (`v`) and the readouts** fade with CSS transitions of the
  same length and a like easing (`index.css` `--fade-ms`, `--fade-ease`):
  `html.chrome-hidden` takes the panels' opacity to 0, and
  `Celestiary._setNav` takes them out of layout once faded out
  (`display: none`, so they take no clicks or focus), and lays them out a
  frame before fading them in.
- **The Milky Way (`U`)** isn't an overlay: the sky's own light, it
  switches.

### Declutter

Labels that would touch are thinned, so a name is either readable or
deliberately hidden ([#207](https://github.com/celestiary/web/issues/207)):
the bodies' names where Jupiter and its four Galileans are a few pixels apart
at a telescope's field (`fov=0.91deg`, [#192](https://github.com/celestiary/web/issues/192)'s
view: five names piled into one smudge), and the places' on a surface, where
tiers 2 and 3 put hundreds in view.  **Labels engine** is the name for the
one path every such label takes, on both sides of the Cesium swap:
a catalogue (Planet's name, Places' tiers) builds a `SpriteSheet`, compiled
to one `Points` on the overlay layer, which draws after the composite, so a
Cesium layer changes nothing about it; its sheet carries `labelTargets` (what
each label is of; [picking](#picking-labels)), and `labelRank` and
`declutter` where it takes part in this.  What a Cesium layer hides is the
surface group only ([CESIUM.md](CESIUM.md#what-changes-while-a-cesium-layer-is-active)).

**The pass** (`js/scene/labelDeclutter.js`), once a frame in
`ThreeUI.renderLoop`, after the scene is drawn (so the world matrices are this
frame's) and before the overlay pass that draws the labels:

1. `labelBoxes` projects the labels of the visible sheets that opt in to
   their text boxes on screen, as a pick does ([picking](#picking-labels)):
   the far side of a body's surface labels is left out (the shader would
   discard them), and so is anything more than 120 px off the canvas.  The
   labels the pass has hidden are in this list: they are judged again each
   frame.
2. Order, most important first: **the target's label** (`isTargetLabel`:
   the targeted body's name, or the targeted place's, so it is never hidden),
   then **rank** (`userData.labelRank` of the sheet, by label), then the
   nearer the camera.  Rank is one scale for every kind: a body's is
   1000 + log10(radius in m) (the larger body wins: Jupiter over Ganymede,
   Callisto, Io, Europa; a body's name over any place's), a place's is
   4 - its tier + its place in the tier, which the catalogue keeps largest
   first (the larger feature wins).
3. `declutter` goes down the order: a label is drawn if its box, grown by 3 px,
   touches none already drawn, else hidden.  What is hidden hides nothing: with
   A over B over C, where A and B touch and B and C touch, B is hidden and C
   is drawn.  A grid of 96 px cells keeps it linear in the number of labels.
4. `SpriteSheet.setShown` writes each decision into the sheet's `shown`
   attribute (1 or 0 per label), uploaded only when it changed, and the sprites'
   vertex shaders move a hidden label off the clip volume.  A hidden label
   isn't picked either (`labelBoxes` leaves it out unless asked).

Where labels don't touch nothing changes: every label's `shown` stays 1.  It
is hide-only; an offset along a leader line, or hiding a moon's name until a
hover, are the other ways [#207](https://github.com/celestiary/web/issues/207)
names, and they'd need a label to draw away from its position, which none
of the sprites do.  Star names, asterism names and the target star's label are
left as they were (they don't take part, and don't hide anyone's): a catalogue
of thousands of names whose priority is the star catalogue's business
([Stars](js/scene/Stars.md)).  A sheet opts in by `userData.declutter = true`
and `userData.labelRank`, so it is a few lines for another kind of label.

**Cost.**  Per frame: a walk of the scene to the visible sheets (a few hundred
nodes), one matrix per sheet, and a few multiplies per label (a surface label's
far side is dropped before it is projected; a label well off the canvas isn't
boxed).  Measured on its own (a bun micro-benchmark over the real functions,
the fastest of 4,000 calls, on a machine shared with other jobs): 0.03 ms for
the Moon's 435 tier 0-2 places with the 23 bodies' names and a 2,000-label sheet
that doesn't take part, and 0.09 ms with all 1,948 places built, 294 of them on
screen.  Tier 2 and 3 are built only for the ground in view (places.md), so a
real frame is the first.  In the page, headless Chromium on SwiftShader under
the same load, the `labels` row of `?perf=1` reads 0.07-0.4 ms, the spread
being the machine's (`?perf=1&off=labels` shows the labels undecluttered, with
the pass out).  It is a CPU cost only: the GPU draws the same sprites, a hidden
one clipped in its vertex shader.

## Performance panel

The `` ` `` (backtick) key toggles three's own `Stats` panel (FPS, MS, MB; click it to cycle the view), for judging frame cost, e.g. on a real GPU.  `ThreeUi.togglePerfPanel()` builds it on the first press (`three/examples/jsm/libs/stats.module.js`, no new dependency) and afterwards only shows or hides it, so startup and the tests never touch the DOM for it.  It's listed in Settings under Info as "Toggle performance panel".

- **Place:** bottom-right, above the fullscreen control: top-left is the search and info panel (its system list can run down the left side), top-right the time controls, bottom-left the settings icons, and bottom-centre the Cesium credits.  It's `position: fixed` at `z-index` 1000 above the canvas, and only its own box takes pointer events.
- **What it measures:** `Stats.begin()`/`end()` bracket `renderLoop()`, so MS is the CPU time to issue the frame (scene update and GL calls), not GPU time, and FPS is the frame rate the browser delivers.  On a GPU-bound view the FPS drops while MS stays low.  MB only exists in Chromium.
- **Outside the visibility groups:** it's a developer tool, not a scene or chrome feature, so neither `v` nor `V` hides it.
- **Typing:** `Keys.onKeyDown` ignores every key while an `INPUT`, `TEXTAREA`, `SELECT` or contenteditable element has focus, so the search box still takes a backtick.

## Perf overlay

`?perf=1` shows per-pass cost on the machine at hand ([#189](https://github.com/celestiary/web/issues/189), the measuring step of [#121](https://github.com/celestiary/web/issues/121)'s surface work).  The [performance panel](#performance-panel) says how fast the frame is; this says where its time goes, and it can tell a GPU-bound frame from a CPU-bound one, which the sandbox's SwiftShader can't.  It is instrumentation only: it changes no pass.  Code: `js/perf/`.

- **Off by default, at no cost.**  `perf.install(this)` in the `ThreeUi` constructor reads `?perf=1` (or `?perf=sync`; the app keeps the query string when it rewrites the address bar's hash, `permalinkHref`).  Without it `perf.enabled` is false and every hook returns at its first line: no timer queries, no wrapped GL calls, no DOM, `renderer.info` left alone, no `window.perf`.  A frame makes the same GL calls as before.
- **In the DOM, not the scene,** bottom-left above the settings icons (top-left is the info list, top-right the time controls, bottom-right the Stats panel), updated twice a second, so it adds nothing to the frame it measures.  Click the `-` to fold it to its title line.
- **The table.**  One row per pass, a `total`, then Cesium's shadow context and a line of the counts that aren't columns:
  - **GPU** (mean and p95 over the last 240 frames, ms) from `EXT_disjoint_timer_query_webgl2` (`GpuTimer.js`).  A query is read frames after its frame (never waited for), and `GPU_DISJOINT_EXT` drops every frame in flight.  A pass that didn't run in a frame counts as 0 in it (`runShare`, in the JSON, is the share of frames it did).
  - **CPU** (mean and p95): the time to issue the pass.  It is the GPU's only where something waits for the GPU: a `readPixels` into client memory (the `meter` row's, with `?meter=sync` or `?hdr=0`, is how far the GPU is behind when the meter reads back; by default the meter reads through a pixel-pack buffer and waits for nothing, [HDR.md, the meter's readback](js/scene/HDR.md#the-meters-readback)).
  - **draws, rt, rb**: draw calls, render-target switches and readbacks into client memory, per frame, by the pass they happened in.  The line under the table adds full-screen passes, clears, blits, texture uploads (with their size), pixel-pack-buffer reads, program changes and triangles.  `renderer.info` counts only three's draws (`three` in the JSON); the wrapped GL calls (`glCounters.js`) count the replayed Cesium ones too.  "Full-screen" is a heuristic: a draw of at most six vertices into a viewport of at least a fifth of the canvas.
  - **On ANGLE Metal (Apple GPUs in Chrome) the GPU column is per encoder, not per pass**, as the first M2 measurements showed: passes recorded into one Metal encoder read the same time (`cesium`, `cesium.blit` and `cesium.shell` each about 50 ms) and the rows add up to 7-10 times the frame.  The overlay detects it (an unmasked renderer string with "Metal", or the passes' means adding up to more than 1.5 frame intervals), heads the column `GPU?`, says so, gives no GPU total, and writes `timer.granularity: "encoder"` into the JSON.  Use sync timing there.
  - Without the extension (Safari doesn't have it; a browser's privacy settings may hide it, as Brave's can) the GPU columns read `n/a`, a note says so, and the CPU times, counts and toggles remain.
- **Sections that nest.**  One `TIME_ELAPSED` query can run at a time, so a pass inside another (the galaxy's march inside the scene render, Cesium's replay inside the composite) can't have its own query running inside the outer one's.  `sections.js` makes a pass a series of segments: opening one stops the one under it, closing it starts that one again.  Each pass's time is its own, the inner ones taken out, and the rows add up to the frame (`other` is whatever runs under no pass: the base of every frame).  `TIMESTAMP` queries would do without this, but not every browser with the extension reports timestamp bits, so it isn't used.
- **Sync timing** (`?perf=sync`, or the *sync timing* checkbox; `barrier.js`): at the end of every pass (every segment, `sections.js`) the page waits for the GPU (`gl.finish()`; or with `&barrier=read`, if a browser's `finish` doesn't wait, a clear and 1x1 `readPixels` of a renderbuffer of its own) and the wall clock times the pass between those waits: each row is that pass's own cost, GPU work included, in the `CPU` column renamed `wall`.  No timer queries run then.  The frame rate is lower than real, the CPU/GPU overlap being gone, so read the rows as shares and costs, not as the frame; the title says SYNC.  Cesium's shadow context is waited on after each of its frames, and that wait is shown on its row and taken out of the pass it happened in.  The waits' own GL calls aren't counted.
- **Sync GL calls.**  Calls that round-trip to Chrome's GPU process and wait for the answer (`getError`, `getParameter`, `getProgramParameter`, `getShaderParameter`, `getUniformLocation`, `getAttribLocation`, `checkFramebufferStatus`, `getExtension`, `clientWaitSync`, `getQueryParameter`, `readPixels` into client memory, and `getBufferSubData` from a pixel-pack buffer, at most a round trip once its fence has signalled) are counted per pass as `syncCalls` (the `sync` column), on the page's context, where Cesium's replayed calls land, and on the shadow contexts, with a per-name breakdown (`syncByName`, per pass and in total, in the JSON).  The overlay's own timer polls and snapshots are muted.
- **The passes** (`passes.js` has the list, and a line for each as the row's tooltip):

  | Pass | What it is |
  |---|---|
  | `update` | The animation callback, camera and navigation, before any rendering. |
  | `scene` | `renderer.render(scene)` into the scene buffer: bodies, stars, the Sun, the galaxy's composite. |
  | `galaxy` | The Milky Way's march into its cached target (`MilkyWay.js`), only on a frame where the view changed. |
  | `cesium` | The composite's own work: clears, the fading celestiary surface, the JS between steps. |
  | `cesium.blit` | Copying the scene's depth into Cesium's target, per body. |
  | `cesium.shell` | The stencil shell: where the body shows. |
  | `cesium.replay` | Cesium's frame, replayed on this context by portal-netgl: Cesium's draws, post-process stages and queued uploads.  The GPU time of the draws, here; the JS of `widget.render()` in CPU. |
  | `cesium.decode` | The full-screen decode of Cesium's 8-bit frame into the scene buffer's units. |
  | `cesium.nightlights` | Earth's second Cesium frame (lights only, unlit), replayed and decoded: the same costs as the day frame's, in one row. |
  | `cesium.ground` | Each Cesium body's ground-sphere depth, for the atmosphere pass. |
  | `clouds` | Earth's cloud shell. |
  | `clouds.volume` | Earth's volumetric clouds up close: the march into their half-size target ([atmos/clouds.md](js/scene/atmos/clouds.md)); nothing above 30 km over the deck. |
  | `atmosphere` | The full-screen pass to the screen: sky, the scene through its transmittance, and the one tone map. |
  | `meter` | The exposure meter's render into 32x32 and its `readPixels` into a pixel-pack buffer (`pboReads`), every fourth frame, and the copy out of the buffer (`getBufferSubData`, a sync call) a frame or more later, once its fence has signalled; with `?meter=sync`, `?hdr=0` or no WebGL2 sync objects a `readPixels` into client memory (`readbacks`). |
  | `labels` | The label declutter: which bodies' and places' names would touch, hidden for the overlay pass ([Declutter](#declutter)). |
  | `overlay` | Labels, orbit lines and grids over the tone-mapped frame. |
  | `other` | GL work in no pass above. |

  The dotted `cesium.*` names are children by name only: `cesium`'s own row doesn't include them.
- **Cesium's shadow context.**  Cesium draws into a second, hidden WebGL context (the NetGL guest's shadow), and every draw runs there as well as in the replay ([#103](https://github.com/celestiary/web/issues/103)).  That context is reachable (`guest.core.shadow`), so it gets a timer of its own and its own counts, shown as `cesium.shadow.<body> (own GL context)`: the GPU time of Cesium's frames on it, which is not in the `total` (another context's clock; its work shares the GPU with the page's).  A readback there (Cesium's picking) shows in its `rb`.
- **Toggles** (`toggles.js`): `?perf=1&off=atmosphere,clouds` or the checkboxes switch a pass off, to bisect cost by frame rate where there is no GPU timer, and the numbers restart.  Each leaves the rest drawing; the picture differs while one is off.  Three kinds: `skip` (the pass's own `if (perf.begin(...))` doesn't run it: `clouds`, `nightlights`, `meter`, `labels`, `overlay`), `gate` (`atmosphere`: the pass is also the frame's one trip to the screen and its tone map, so it runs with the sky off, `uAtmEnabled` 0) and `hide` (`galaxy`, and `sun`, the Sun's layers (Sun.md): the object is hidden and put back as it was).  `cesium` is `skip` at the source: with it off no body is wanted, so celestiary draws its own Earth, Moon and Mars.  With the meter off the exposure stops adapting.
- **Copy JSON** puts a snapshot on the clipboard (`snapshot.js`; where the clipboard is refused, a text box to copy from): the page's URL (the view's permalink), the viewport and drawing buffer sizes, `devicePixelRatio`, the GPU (`WEBGL_debug_renderer_info` where the browser shows it), the user agent, whether the GPU timers work, the target and active Cesium bodies, the toggles, every pass's GPU, CPU and counts, and the totals.  `window.perf.snapshot()` gives it in the console.
- **Adding a pass** (a later change's own render pass, e.g. the night sky's): bracket it, `perf.begin('name')` before and `perf.end('name')` after, one line each in the loop; and add `{name, what}` to `PASSES` in `passes.js`, which orders the rows and writes the tooltip (a pass left out is still timed and listed, after the others).  A pass that can be switched off is `if (perf.begin('name')) {...; perf.end('name')}`, with an entry in `TOGGLES`.  Nesting is fine; name a child with a dot.  An exception between `begin` and `end` is covered: the frame's end closes whatever is open.
- **What it can't see:** the compositor and the swap (the gap between the frame interval and the GPU total), a browser that rounds timer results, and work that runs between frames.  In the sandbox's headless Chromium (SwiftShader) the extension exists, so the code path runs, but its times are a CPU's emulation of a GPU: evidence of the plumbing, not of cost.

## State Management (Zustand)

`js/store/useStore.js` composes four slices:

- `AsterismsSlice` — asterisms visibility and catalog state
- `ColonizationSlice` — mirrors the `x` setting (human expansion lines) for the drawer's switch
- `WidgetsSlice` — the widgets drawer and dock: open, docked, the app showing, running and pinned apps, and the running apps' state for the permalink
- `SearchSlice` — search-bar state, anchor index, the target
  (`committedTarget`, with `committedPath` and `committedStar` as views of
  it; written only by `Scene.setTarget`), preview fields
- `StarsSlice` — star selection / filter state
- `TimeSlice` — time panel UI state

The store is passed into non-React classes (`ThreeUi`, `Stars`) to let them read/write shared state without React prop-drilling.

## Routing

Two routing layers coexist:

- **Wouter path routing** (`/`, `/guide`, `/about`, `/settings`) — controls which React panels are shown
- **URL hash** (`#sun/earth/moon`, `#sun/earth/austin`, `#hip:32349`) — names the target ([the target](#the-target)) and drives what's loaded; managed imperatively by `Celestiary` via `hashchange` events (`_navigate`)

The hash is extended with optional camera/time state to form a **permalink** — see [js/permalink.md](js/permalink.md) for the format specification — and with **state tokens** for the widgets drawer and its apps ([design/URLs.md](design/URLs.md)).

## React UI Components (`js/ui/`)

Thin MUI-based overlay panels:

- `TimePanel` — displays sim time, pause/play, time-scale controls
- `WidgetsDrawer` — the widgets drawer and dock, behind the Widgets button
  (below)
- `ColonizationApp` — the Human Expansion app's panel
  ([Colonization.md](js/scene/Colonization.md))
- `Settings` — keyboard shortcut reference
- `About` — app info and star catalog stats
- `SearchBar` — breadcrumb-anchored search (chips, MUI `Autocomplete`,
  Go / Look at buttons, crosshair picker toggle, preview + commit flow). See
  [js/search/DESIGN.md](js/search/DESIGN.md) for the index architecture.
- `DatePicker`, `NumberField`, `NumberInput` — supporting inputs
- `TooltipToggleButton`, `TooltipIconButton`, `NavToggleButton` — icon button wrappers

### Widgets drawer and dock

Optional tools ("apps") live in a drawer on the right, opened by the
Widgets button (top right).  `ui/apps.jsx` lists them: a name, an icon, a
panel, and a `stop` that removes whatever the app added to the scene.
State is `store/WidgetsSlice.js`, a pure reducer (tested without a DOM):

- **Three states.** Closed; open, the drawer over the right of the canvas,
  showing the app tray or one app; and dock, a 56 px bar of icons right of
  the canvas.  The dock shows while docked (the drawer's dock button) or
  while any app is pinned.  The canvas narrows for it
  (`Celestiary.setInsets`), and `#top-right` moves left of it
  (`--dock-width`), so it never covers the scene; an open drawer sits left
  of it.
- **Phones** (`useIsMobile`, 600 px wide or less).  The open drawer is a
  sheet over the bottom half of the screen instead, and the scene shrinks
  to the half above it (`setInsets`' bottom), so an app's effects show
  while it's used.  The bottom controls move up above the sheet
  (`--sheet-height`).
- **Sizing.**  `Celestiary` owns the scene's size: the window less the
  dock and sheet, redone on every resize (a phone rotating, its browser
  bars coming and going).  `ThreeUI.onResize` reads the container's size,
  never the window's.  The target's info panel scrolls within the scene's
  height (`--scene-height`).
- **Running.** An app runs from when it's opened until stopped.  Its
  header has a pin and an X.  X stops it (`stop`, out of the scene, back
  to the tray).  Closing the drawer stops every app that isn't pinned; a
  pinned app keeps running, panel mounted and state kept, with its icon
  in the dock to reopen it.  The dock can't be closed while an app is
  pinned.
- **Chrome.** The drawer and dock are HTML chrome: `v` hides them.
- **Permalink.** All of it is in the link: the `apps` state token, and
  each running app's state as its own `apps.<id>` token (an app reports
  its state to the slice, which drops it when the app stops;
  `store/appTokens.js` encodes it).  Spec: [design/URLs.md](design/URLs.md).

## Guide (`js/guide/`)

A separate interactive tutorial route (`/guide`) built with React Three Fiber (`@react-three/fiber`) and Drei. Each guide section is an isolated demo (Cube, Sphere, Star, Planet, Orbit, Stars, Asterisms, Atmosphere, Galaxy, VSOP, Labels, etc.) navigated via a side-drawer TOC. The guide and main app are fully independent bundles — the guide does not use the `Celestiary` class.

A guide page drives a bare `ThreeUi`, so it must supply what the app's `Scene`/`Animation` give it: a star's disc is metered only if `ui.sceneManager.objects` holds it with `props.type = 'star'` (`guide/starScene.js`; without it the Sun shader saturates white, HDR.md "Physical stars"), `ui.useStore` needs a `getState`, a planet's surface shows only once its `preAnimCb` has run, and the Sun's light is `SUN_LUMINOUS_INTENSITY` with `SUN_LIGHT_DECAY`.  Links within a page use `${window.location.pathname}#name`: with `<base href="/">` a bare `#name` resolves to the app root.

## Build & Output

`esbuild` bundles `js/index.tsx` to `docs/` (GitHub Pages target). The `build` script:

1. `yarn clean` — resets `docs/` from `public/`
2. Copies shaders and public assets
3. Runs esbuild bundler

`yarn bundle-check` (part of `yarn precommit`) runs the same build, minified, without writing, and fails if `vsop87` is in the first load (the files the entry and the App route import statically: `esbuild/firstLoad.js`, tested in `esbuild/firstLoad.test.js`) or if the first load is over its [budget](#load-budgets).

Build-time env vars: `BASE_PATH` (the URL prefix the site is served under), `CESIUM_ION_TOKEN`, `DATA_BASE_URL` (where large data is fetched from; see [Data policy](#data-policy)), `CUSTOM_DOMAIN` and `NOINDEX` (see [Hosting and the domain](#hosting-and-the-domain)).

### Load budgets

Two checks keep the first load from creeping back up ([#262](https://github.com/celestiary/web/issues/262), the last of [#256](https://github.com/celestiary/web/issues/256)'s sub-issues).  Their limits are in one file, `esbuild/budget.js`, with a comment on how they were set.

- **Static, in `yarn precommit`** (`yarn bundle-check`, `esbuild/check.js`; `esbuild/staticBudget.js`, tested in `esbuild/staticBudget.test.js`).  From a minified dry-run build, the first load (`esbuild/firstLoad.js`: the entry, the App route, what they import statically, and the CSS they carry) against three limits: its total minified, its total gzipped (zlib in process, close to what Pages sends), and its largest single file.  A failure names each number, the limit and the excess, and lists the first load's biggest files and the biggest contributors (esbuild's metafile inputs; npm packages grouped) of the offending file, so it says what grew: *first load, minified: 7,250 KB, over the 2,350 KB budget by 4,900 KB ... 3,962 KB node_modules/@cesium/engine (1298 files)*.  Deterministic and a few seconds.
- **Runtime, in CI only** (`yarn load-budget`, the `load-budget` job of `.github/workflows/ci.yml`; `tools/loadBudget/`).  It builds the site, serves `docs/` the way GitHub Pages does (`staticServer.mjs`: gzip for all but images and media, `max-age=600`, `404.html` with a 404 for a missing path), opens the homepage in headless Chromium on SwiftShader with other hosts refused (`--host-resolver-rules`, plus `Network.setBlockedURLs` for the hosts the app can reach: fonts, analytics, ion, NASA) and records every request through a CDP session (`Network.requestWillBeSent`, `dataReceived`, `loadingFinished`'s `encodedDataLength`; `network.mjs`), not `page.route`, which turns the HTTP cache off.  Two moments, each with a request count and transferred bytes (encoded body and headers): **ready**, when `window.c.ui.sceneReady()` first holds (the reveal's trigger: [the first load](#the-first-load)), and **settled**, once the ephemeris is in (`c.animation.vsop`) and the network has been quiet for 3 s.  It prints both, the 15 biggest requests and the folders with the most requests, and exits 1 over a limit.  It runs in about 25 s here; as a job of its own it runs beside `precommit` rather than after it, so it adds no wall time unless it's the slower of the two; its runner time (80 s on the first run, against `precommit`'s 118 s) is checkout, LFS, install and build, a cached Playwright headless shell and the measurement.  `--url` measures a deployed page instead (the live site, a PR preview), `--no-budget` only reports (AGENTS.md has the sandbox flags).
- **Setting and changing the limits.**  Each is the measurement on `main` the day it was added (2026-10-15) plus about 10%, so ordinary work doesn't trip it and a new dependency or an eagerly loaded dataset does.  They are a ratchet: a PR that lowers a number (the lazy bodies, places and galaxies of [#258](https://github.com/celestiary/web/issues/258); the star tiers of [#98](https://github.com/celestiary/web/issues/98)) lowers the limit in the same PR, to its new measurement plus the headroom.  One that must raise a limit edits its line and says why in the PR.  Run `yarn bundle-check` and `yarn load-budget` (after `yarn build`) for the numbers.
- **What the numbers are on `main` (2026-10-15):** first load 10 scripts and 2 stylesheets, 2,130 KB minified, 661 KB gzipped, largest file 695 KB.  Homepage: 81 requests and 2,859 KB when ready (1,848 KB of it `stars.dat`), 82 and 4,193 KB settled (the 1,334 KB ephemeris chunk after the reveal).  The live site, the same way: 81 and 2,819 KB, 83 and 4,180 KB.  After [#258](https://github.com/celestiary/web/issues/258) (2026-10-20): 25 requests and 2,614 KB ready, 26 and 3,948 KB settled, so the runtime limits were 28 and 2,880 KB, 29 and 4,350 KB; the first load is unchanged (2,136 KB, 663 KB gzipped).  After [#259](https://github.com/celestiary/web/issues/259)'s star tiers (2026-10-20): 26 requests and 925 KB ready (the bright tier 157 KB of it, where stars.dat was 1,848 KB), 39 and 3,918 KB settled (the 12 faint packs, 1,655 KB, after the reveal); the runtime limits are 28 and 1,020 KB ready, 43 and 4,310 KB settled.  The settled request limit went up, from 29: the faint tiers are 12 requests where stars.dat was one, by design (a deep link needs only its field's), all after the reveal, four at a time.  The first load is 2,147 KB, 667 KB gzipped (the tiers' code, 11 KB); its limits stand.

### Hosting and the domain

The site is hosted on GitHub Pages and served at **celestiary.org**, so search engines credit that domain.

- **One site, at the root.** `deploy-prod.yml` builds with `BASE_PATH=/` and pushes to `celestiary/celestiary.github.io`, the organisation's user page, whose Pages settings carry the custom domain `celestiary.org`.  GitHub redirects the old `celestiary.github.io` addresses (301, the fragment kept by the browser), so shared links and their search weight carry over.
- **`/web/`: the PR previews, and a redirect stub.**  This repo's own Pages site is served under the user page's domain at `celestiary.org/web/`.  It was a second full copy of the site (`BASE_PATH=/web/`, about 173 MB, a duplicate for crawlers) until [#261](https://github.com/celestiary/web/issues/261).  Now it holds:
  - the PR previews, under `pr-preview/pr-N/` of its `gh-pages` branch (`pr-preview.yml`), which load large data from the root ([data policy](#data-policy));
  - a stub at its top, `index.html` and `404.html` (`esbuild/webStub.js`, deployed by `gh-pages.yml` only when the stub's sources change, with `clean-exclude: pr-preview`).  Both are `public/404.html` filled in with `movedTo` `/`: `/web/<route>?<query>#<fragment>` goes to `/<route>?<query>#<fragment>` on the same host, and a preview's deep link (`/web/pr-preview/pr-N/<route>`) to its own preview, as before.  Only the browser has the `#` fragment, so a server redirect couldn't keep a scene link; the stub's script does.  An old deep link takes two hops: the stub, then the root's own `404.html` bounce.
  - **Why `/web/` stays:** the previews need a Pages site other than production's.  Deploying them into `celestiary.github.io`'s `gh-pages` instead (`/pr-preview/pr-N/`) was considered and dropped: every preview push would rebuild production's Pages site and count against its builds (a soft limit of 10 an hour), previews that copy the large data (about 173 MB each) would share production's 1 GB, so a few open at once could stop production deploying, the preview job would need a credential that writes production's branch (a PAT for `pr-preview-action`'s `deploy-repository`, or the deploy key), and the two would push to one branch concurrently.  Kept apart, nothing a preview does can stop production.
- **`404.html`** (`public/404.html`, tested in `esbuild/notFound.test.js`) is the one page GitHub Pages serves for a site's missing paths: the [spa-github-pages](https://github.com/rafgraph/spa-github-pages) bounce (`/about` to `/?/about`, which `index.html` restores), filled in at build time by `esbuild/site.js` `fillPlaceholders` (`{{PATH_SEGMENTS_TO_KEEP}}`, `{{MOVED_TO}}`, `{{SITE_HEAD}}`).  A bounce that lands on a missing base (a removed preview) stops and says so, rather than bouncing for ever.  It sends no referrer (`<meta name="referrer" content="no-referrer">`): `js/Routed.jsx` routes the app to a same-origin referrer's path, which would turn the stub's `/web/#<scene>` into `/web/` and drop the scene.  `yarn serve`'s proxy serves the same page for its misses.
- **`CUSTOM_DOMAIN`** (the build action's `custom-domain`, set only by `deploy-prod.yml`) writes `CNAME`, `robots.txt` and `sitemap.xml` into the root build (`esbuild/site.js`).  `CNAME` matters most: GitHub Pages keeps the custom domain in that file on the deployed branch, and the deploy replaces the branch's contents (`clean: true`), so a build without it would unset the domain on every deploy.
- **The canonical address.** Every build's `index.html` gets `<link rel="canonical">` and `og:url` for `https://celestiary.org/` (`{{SITE_HEAD}}`), so the `/web/` stub and the previews credit the root rather than compete with it.  **`NOINDEX=true`** (`noindex` on the action; PR previews) adds `<meta name="robots" content="noindex">`, and `robots.txt` disallows `/web/pr-preview/`.  The rest of `/web/` stays crawlable, so crawlers follow the stub to the root.
- **What GitHub Pages can't do:** server redirects, headers or rendering.  Deep routes (`/about`, `/guide`) reach the app through `404.html`, so crawlers see a 404 for them, and the `#` fragment of a scene link is never crawled.  What's crawlable has to be real files: the static pages planned under [#244](https://github.com/celestiary/web/issues/244) add themselves to `sitemap.xml`.
- **Limits:** a published Pages site is capped at about 1 GB, with a soft bandwidth limit of about 100 GB a month and a soft limit of 10 builds an hour for a site published from a branch.  Production and the previews are separate sites, so each has its own.  If traffic outgrows it, large data moves to a CDN through `DATA_BASE_URL` / `dataUrl()` without touching the app.
- **Cesium ion:** the token is restricted by Referer, so it must allow `https://celestiary.org/` as well as `https://celestiary.github.io/` (AGENTS.md, Secrets).

`yarn bundle-check` (`esbuild/check.js`) does a dry-run bundle (`write: false`) to verify all imports resolve without writing any output — used in `yarn precommit` alongside lint and tests.

Hot-reload in development: `esbuild/serve.js` calls `ctx.watch()` unconditionally; `index.tsx` opens an `EventSource('/esbuild')` that reloads on `change` events and closes itself on error (silent in production).

## Key Files Reference

### Root infrastructure (`js/`)

| Path | Role |
|---|---|
| `js/shared.js` | Global constants and `targets` state object |
| `js/Celestiary.js` | Top-level controller, keyboard bindings |
| `js/ThreeUI.js` | Three.js renderer/camera/controls wrapper |
| `js/Loader.js` | Recursive JSON asset loader: a body from the bodies' bundle, else its own file ([data loading](#data-loading)) |
| `js/bodyBundle.js` | `loadBodyBundle`: `data/bodies.json`, every body's descriptor, fetched once for the page |
| `js/Time.js` | Simulation clock with time-scale control (settable while paused: `j`/`k`/`l` and the panel's buttons; `onTimeScaleChange` tells the display), clamped to the supported dates (J2000 ± 6000 years) |
| `js/camera.js` | Navigation tween factories (`newCameraLookTween`, `newCameraGoToTween`, `newCameraLandTween`); the ones that move the camera are marked `travels`, and a go says how far along it is (`travelProgress`, which the exposure follows: [approach](#approach)) |
| `js/zoom.js` | Pure zoom math: `asymptoticZoomDist`, `dynamicNear` |
| `js/faceKeepingRoll.js` | `faceKeepingRoll(camera, point)`: the shortest turn that centres a world point, leaving the camera's roll; what tracking (`t`) calls |
| `js/follow.js` | `rehangPlatform(platform, camera, anchor)`: hang the camera platform on a node, keeping the camera's world position and orientation; what following (`f`) does ([follow](#follow)) |
| `js/navMode.js` | `formatNavMode(mode, on)`: "Tracking on", "Following off", for the readout |
| `js/choreography.js` | The first load's reveal: `Choreography` (steps at times after a start, on the frame clock), `REVEAL_AT`, `READY_TIMEOUT_MS` ([the first load](#the-first-load)) |
| `js/loading.js` | `hideLoading()`: fades out the page's loading text (`public/index.html` `#loading`); `handOffLoadingTitle()`: the loading title becomes the homepage's ([homepage](#homepage)) |
| `js/home.js` | The homepage: `isHomepage` (the bare URL), `HOME_HISTORY_KEY`, `HOME_CARDS` ([homepage](#homepage)) |
| `js/changelog.js` | The changelog in the app: `loadChangelog`, `parseChangelog`, the "new since your last visit" marker (`checkNew`, `markSeen`, from the dates in `changelogStamp.json`: `stampEntries`, `freshIds`), the tour's stops, captions and token (`tourStops`, `tourCaption`, `holdMs`, `decodeNewsToken`) ([what's new](#whats-new-and-the-changelog-tour)) |
| `js/newsTour.js` | `NewsTour`: the changelog tour's sequencing (fly, caption, hold, next, previous, pause, stop), pure on the frame clock |
| `js/flight.js` | `FlightPath`: a flight from the camera to a view, in log altitude; `timePlan`, `flightDuration` ([flights from the homepage](#flights-from-the-homepage)) |
| `js/tour.js` | Camera paths: `CameraPath` (keyframes eased and interpolated), `ease`, spherical offsets ([the tour](#the-tour)) |
| `js/tourDriver.js` | `TourDriver`: plays a path on the scene, on the frame clock |
| `js/homeTour.js` | The homepage's tour: `homeTour(ms)`, `homeTourKeyframes`, its still and loop fade |
| `js/nightSide.js` | The tour's Earth segment, planned against the Sun: `chooseNightSide` (the brightest night side near midnight), `passGeometry`, `tourAngles` ([the tour](#the-tour)) |
| `js/scene/nightLights.json` | City light per 5° cell from Earth's night-lights texture, by `tools/home/nightLights.py` ([Planet.md](js/scene/Planet.md#city-light-per-cell)) |
| `js/tonight.js` | Tonight's sky: `sunAltitude`, `tonightTime` (astronomical dusk), `resolveLocation` (geolocation, time zone, default) |
| `js/ui/Homepage.jsx` | The homepage's foreground: the title, the search (`SearchBar` `home`), the cards |
| `js/ui/WhatsNew.jsx` | The homepage's What's new panel: the latest entries, Fly there, Tour from here |
| `js/ui/NewsTour.jsx` | The changelog tour's caption and controls, over the scene (icons in `js/ui/NewsIcons.jsx`: plain SVG, so they render in tests without MUI's styling engine) |
| `js/store/HomeSlice.js` | `homePhase`: the foreground's waiting, in, out or hidden |
| `tools/home/cards.mjs` | Renders the cards' images, `public/images/home/<id>.webp` (`--gpu` on a real GPU), or any one view as a PNG (`--hash`, `--id`, `--png`) |
| `tools/posts/` | `yarn posts`: social post drafts from the featured changelog entries into `posts/drafts.md`, merged so the maintainer's edits stay; length counting per platform; the first campaign; `social.mjs`, the live posts' URLs for `yarn changelog` ([README](tools/posts/README.md)) |
| `js/socialLinks.mjs` | The platforms an entry's posts can be on (X, Facebook) and the URLs that may be linked: https on their own hosts; read by the build and the app |
| `js/scene/fade.js` | The overlays' fades: `Fade`, `FadeDriver`, `fadeMaterial`, `fadeObject`, `ease` ([fades](#fades)) |
| `js/permalink.js` | Permalink encode/decode: `encodePermalink`, `decodePermalink`, `pathFromFragment`; state token values (`parseTokenValue`, `formatTokenValue`) |
| `js/targetPath.js` | The target's path in the hash: `targetPath`, `parseTargetPath`, `resolvePlace` (a body or a place), `slug` |
| `js/store/appTokens.js` | The widgets drawer and its apps as state tokens (`apps`, `apps.<id>`; [design/URLs.md](design/URLs.md)) |
| `js/coords.js` | Geographic coordinate conversions: `worldToLatLngAlt`, `latLngAltToLocal` |
| `js/store/useStore.js` | Zustand store root |
| `js/dataUrl.js` | `dataUrl()`: resolves large-data paths against the build's data base URL ([Data policy](#data-policy)) |
| `js/perf/` | The `?perf=1` overlay ([Perf overlay](#perf-overlay)): `perf.js` (the hooks and the install), `GpuTimer.js`, `sections.js`, `glCounters.js`, `PerfStats.js`, `Overlay.js`, `snapshot.js`, `toggles.js`, `passes.js` |
| `public/data/*.json` | Celestial object descriptors; `bodies.json` is every one under the Milky Way, built by `yarn bodies` (`tools/bodies/build.mjs`) |
| `public/data/places-index.json` | Every body's places for the search, built from `public/data/places/` by `yarn places-index` (`tools/places/index.mjs`) |

### Search (`js/search/`)

| Path | Role |
|---|---|
| `js/search/SearchIndex.js` | Tiered index + app-wide singleton |
| `js/search/SearchRegistry.js` | Provider registration singleton |
| `js/search/SearchProvider.js` | JSDoc typedefs for `SearchEntry` / provider contract |
| `js/search/commitEntry.js` | Go and Look at actions for a result |
| `js/search/providers/SceneProvider.js` | Bodies loaded by `Loader` |
| `js/search/providers/StarsProvider.js` | Named stars + exact HIP resolver |
| `js/search/providers/PlacesProvider.js` | Surface places, from the places' index (`js/search/placesIndex.js`), fetched on the first search |
| `js/search/providers/GalaxiesProvider.js` | SPARC's galaxies, by all their names |

See [js/search/DESIGN.md](js/search/DESIGN.md) for the full architecture:
tier structure (A/B/C), Fuse.js tuning, scoping semantics, commit flow,
and the provider extension contract.

### Scene objects and support (`js/scene/`)

| Path | Role |
|---|---|
| `js/scene/Scene.js` | Scene object registry, targeting, raycasting |
| `js/scene/Animation.js` | VSOP87 (loaded lazily, with the glide from the stand-in) + Keplerian orbit/rotation animation |
| `js/scene/planetsApprox.js` | The planets from Standish's mean elements: the stand-in before VSOP87C has loaded ([before the ephemeris loads](#before-the-ephemeris-loads)) |
| `js/scene/lunarTheory.js` | The Moon: Meeus ch. 47 position, mean orbit of date (and Cassini-law orientation, now only a check) |
| `js/scene/meanElements.js` | Pluto and the moons: mean elements in their reference planes, Kepler's equation |
| `js/scene/orbitElements.js` | A body's six orbital elements of the date, from its own source, for the info panel and the diagram ([orbital elements](#orbital-elements)) |
| `js/scene/orbitDiagram.js` | The diagram of an orbit's elements, each lit on its own; the app's and the guide's ([orbital elements](#orbital-elements)) |
| `js/scene/lagrange.js` | A pair's Lagrange points, the secondary's Hill radius and synchronous orbit ([Lagrange.md](js/scene/Lagrange.md)) |
| `js/scene/LagrangeMarks.js` | The target's pairs' points, Hill spheres and synchronous orbits, drawn in the orbits group ([Lagrange.md](js/scene/Lagrange.md)) |
| `js/scene/regimes.js` | A body's orbital regimes: Earth's shells, boundaries and orbit families, sun-synchronous orbits ([Lagrange.md, orbital regimes](js/scene/Lagrange.md#orbital-regimes)) |
| `js/scene/RegimeMarks.js` | The target's regimes, drawn in its equator in the orbits group ([Lagrange.md, orbital regimes](js/scene/Lagrange.md#orbital-regimes)) |
| `js/scene/satellites/` | Earth's satellites: CelesTrak's GP elements (`public/data/satellites.json`) by SGP4 (satellite.js), TEME to Earth's equator under its planetTilt, drawn in the orbits group, targeted as `{kind: 'satellite'}`, gone to and ridden ([Satellites.md](js/scene/satellites/Satellites.md)) |
| `js/scene/cr3bp.js` | The circular restricted three-body problem: equations, an integrator with the state-transition matrix, the correction that closes a symmetric orbit ([Lagrange.md, three-body orbits](js/scene/Lagrange.md#three-body-orbits)) |
| `js/scene/periodicOrbits.js` | A pair's three-body families (Lyapunov, halo, DRO, the 9:2 NRHO) from their first guesses, sampled and swept out in space ([Lagrange.md, three-body orbits](js/scene/Lagrange.md#three-body-orbits)) |
| `js/scene/overlayMarks.js` | What the marks of orbital space share: unit rings and ellipses, labels, screen sizes, a sphere's outline as seen |
| `js/scene/iauRotation.js` | IAU WGCCRE rotation models: pole, prime meridian, body orientation; Jupiter's System II cloud texture turn. Data in `iauRotation.json` (`tools/iau/pckRotation.mjs`) |
| `js/scene/orbitPath.js` | Orbit lines sampled from the planets' and the Moon's ephemerides, and their budgeted rebuilds |
| `js/scene/bodyLine.js` | An orbit line as drawn: a fine arc around the body and a float64 line written relative to it, so it passes through the body's centre close up |
| `js/scene/celestialFrame.js` | GMST, TT − UTC, ecliptic precession between dates (coordinates and scene rotation) |
| `js/scene/StellarFrame.js` | Parent of the J2000 catalogues: precesses them to the simulation date |
| `js/scene/rte.js` | Relative-To-Eye camera uniforms in an object's own frame |
| `js/scene/Planet.js` | Planet/moon scene graph construction |
| `js/scene/Spacecraft.js` | A spacecraft: its model at its place on a trajectory table, turned to the Sun ([models.md](js/scene/models.md)) |
| `js/scene/model.js` | `loadModel`: glTF models, lazily loaded, metres, lit by the Sun ([models.md, the loader](js/scene/models.md#the-loader)) |
| `js/scene/trajectory.js` | A spacecraft's JPL Horizons table, interpolated (cubic Hermite) and taken to the scene's frame ([models.md, positions](js/scene/models.md#positions)) |
| `js/scene/sharedImage.js` | One fetch of an image for every consumer: the surface's `<img>`, the clouds' pixels, Cesium's `blob:` URL (Earth's month of Blue Marble; [Planet.md](js/scene/Planet.md#one-fetch-of-the-months-blue-marble)) |
| `js/scene/clouds/` | Earth's clouds: `cloudSource.js` (date to GIBS layer, unmixing; pure), `cloudDay.js` (a day built whole, the day to show, the fade at ±180°; pure but for the injected fetch), `CloudMap.js` (loading, the coverage texture; the bundled `earth_atmos.jpg` only when a day needs it, a 128 KB copy for the polar gaps, `tools/clouds/bundledFill.py`), `CloudShell.js` (the shell and its shader); up close, `CloudVolume.js` (the ray-marched layer, its target and history), `cloudPhysics.js` (the model: extinction by cloud type, the delta-Eddington slab, the bodies' parameters; pure), `cloudNoise.js` (tiling Perlin-Worley; pure), `cloudPhase.earth.json` (the droplets' Mie phase function, from `tools/clouds/miePhase.mjs`) ([atmos/clouds.md](js/scene/atmos/clouds.md)) |
| `js/scene/farPoint.js` | A body's far point: its mesh range (and `FovLOD`, which scales it by the FOV), colour, size and depth state |
| `js/scene/smallDisc.js` | A body's disc a few pixels across: antialiased coverage and the sphere's shading per fragment, patched into the surface material ([Planet.md](js/scene/Planet.md#small-discs)) |
| `js/scene/standInMaps.js`, `js/scene/textureMeans.json` | One-texel stand-ins for a body's maps while they load (the colour map's mean, built by `tools/textureMeans.py`; a flat normal) ([Planet.md](js/scene/Planet.md#while-the-maps-load)) |
| `js/scene/atmos/atmosphereBody.js` | Which body's air the atmosphere pass draws, and how far off it can |
| `js/scene/Star.js` | A star: its light, its photosphere (`photosphere(props)`, `star-shaders.js`), its glare and, for the Sun, its layers (`sun/SunLayers.js`) |
| `js/scene/sun/` | The Sun past its photosphere ([Sun.md](js/scene/Sun.md)): the sunspot number by date (`solarCycle.js`, SWPC's data in `sunspots.json`, `tools/sun/sunspots.mjs`), active regions, flares, CMEs and prominences (`activeRegions.js`, `solarEvents.js`), the K-corona (`corona.js`), eclipses (`eclipse.js`), the eye's glare (`glare.js`), the Carrington frame (`sunFrame.js`), the solar wind (`SolarWind.js`), and their meshes (`SunLayers.js`, `sun-shaders.js`) |
| `js/scene/stellar.js` | Stars' physics: temperature from class, blackbody colour and luminance, bolometric correction, limb darkening, granulation and spot laws ([Stars.md](js/scene/Stars.md)) |
| `js/scene/starParams.js` | Every star's parameters: measured where published, else luminosity class, radius (Stefan-Boltzmann), mass and gravity from the catalogue; rotation (Roche, von Zeipel) and spots by type |
| `js/scene/Stars.js` | Star field from Celestia catalog: loaded as brightness tiers (or stars.dat whole), its readiness, a star's wait for its tier, picking's index, labels ([Stars.md](js/scene/Stars.md#brightness-tiers)) |
| `js/scene/catalogue/` | The catalogue as brightness tiers on the point-population engine ([Stars.md](js/scene/Stars.md#brightness-tiers)): the rule and constants (`tiers.js`), the build (`build.js`, run by `tools/stars/build.mjs`, `yarn stars`; checked by `tools/stars/stars.test.js`), a tile to its stars and points (`catalogueTile.js`), the population (`cataloguePopulation.js`) |
| `js/scene/starsMaterial.js` | The star points' material, one for the catalogue and every star population (`POINT_MOTION` moves a population's points by their velocities) |
| `js/scene/points/` | The point-population engine ([Gaia.md](js/scene/Gaia.md#the-engine)): `PointPopulation.js` (loading, drawing to a budget, eviction; or held whole and drawn whole, packs), `selection.js` (which tiles, to the limiting magnitude, from anywhere), `tileTree.js` (HEALPix cells by magnitude), `tileFormat.js`, `healpix.js`, `starTile.js` (a tile of stars to the star shader's attributes) |
| `js/scene/gaia/` | Gaia DR3's stars ([Gaia.md](js/scene/Gaia.md)): the archive queries (`adql.js`), J2016.0 ICRS to the catalogue frame and J2000.0 (`astrometry.js`), G to V and BP−RP to Teff (`photometry.js`), the merge with stars.dat (`dedup.js`), the build (`build.js`, run by `tools/gaia/gaia.mjs`, `yarn gaia`), the population in the scene (`gaiaPopulation.js`) |
| `js/scene/MilkyWay.js` | The Milky Way's integrated light: the march pass and its cache, which the atmosphere pass draws ([MilkyWay.md](js/scene/MilkyWay.md)) |
| `js/scene/galaxyModel.js` | A disc galaxy's structural model, for any galaxy's spec (`MILKY_WAY` is the Milky Way's): its components, the baked in-plane map, the normalisation, the share the star catalogue resolves, the JS march and the GLSL (the Milky Way's own program, or one uniform-driven program for every other) |
| `js/scene/sparcGalaxy.js` | A SPARC galaxy's spec from its catalogue row: measured where SPARC, RC3 and the cross-match measured it, else type-driven defaults with their sources; its placement on the sky and its far point's dust ([Galaxies.md](js/scene/Galaxies.md)) |
| `js/scene/Galaxies.js` | SPARC's galaxies in the scene: far points (and the Milky Way's), impostors, the near march, map bakes; the records the search and `goTo` use ([Galaxies.md](js/scene/Galaxies.md)) |
| `js/scene/rotationCurve.js` | A galaxy's rotation curve against its baryons' (SPARC's mass models), and the info panel's plot of it |
| `public/data/sparc/` | SPARC's 175 galaxies (`galaxies.json`, cross-matched) and their mass models (`curves.json`), built by `tools/sparc/buildSparc.mjs` |
| `js/scene/eye.js` | The dark-adapted eye's threshold against field size (Ricco, Piper), the extended response's gain, scotopic colour, surface brightness in exposure units ([HDR.md](js/scene/HDR.md#the-eye-and-extended-light)) |
| `js/scene/nightSky.js` | The night sky's own light: the interplanetary dust cloud (Kelsall et al. 1998) integrated along a ray from anywhere, for the zodiacal light and gegenschein, and airglow's path (JS and GLSL) |
| `js/scene/ZodiacalLight.js` | The zodiacal light's cache: the dust cloud's integral from the camera into a reduced-size half-float target, rendered when the view changes by more than it can show |
| `js/scene/viewCache.js` | When a cached view of something smooth (the galaxy's march, the zodiacal light) needs rendering again: moved, turned half a texel, or reprojected |
| `js/scene/Galaxy.js` | Animated galaxy particle system |
| `js/scene/Asterisms.js` | Constellation line drawings |
| `js/scene/Colonization.js` | Human expansion: kNN star graph and layered BFS spread from the Sun |
| `js/scene/ColonizationLines.js` | Human expansion lines, coloured by hop and grown over time |
| `js/scene/wideLines.js` | Wide antialiased lines: segments (asterisms, human expansion) and strips (orbits) |
| `js/scene/Orbit.js` | Orbital path visualization |
| `js/scene/StarsCatalog.js` | Celestia binary star catalog parser; one star from its stored values (`catalogueStar`, shared with the tiers) |
| `js/scene/AsterismsCatalog.js` | Constellation pattern definitions |
| `js/scene/object.js` | Base `Object3D` wrapper with registry tracking |
| `js/scene/shapes.js` | Geometry factory functions (sphere, rings, etc.) |
| `js/scene/material.js` | Texture/material cache |
| `js/scene/SpriteSheet.js` | Canvas-based label sprite atlas |
| `js/scene/GalaxyBufferGeometry.js` | Packed vertex data for galaxy particles |
| `js/scene/StarsBufferGeometry.js` | Packed vertex data for star catalog |
| `js/scene/Picker.js` | Star picking by ray (`queryPoints`) and the surface point under the pointer (`pickSurfaceLatLng`) |
| `js/scene/labelPick.js` | The label hit test for every label ([Picking labels](#picking-labels)); `labelBoxes` is also the declutter's projection |
| `js/scene/placeCells.js` | A tier of surface labels grouped by cell of the sphere, and the horizon test that says which are in view ([places.md](js/scene/places.md#tier-scheme--lod)) |
| `js/scene/labelDeclutter.js` | Which labels are drawn where two touch: ranks, the order, the greedy pass, `declutterLabels` once a frame ([Declutter](#declutter)) |
| `tools/places/` | Builds `public/data/places/<body>.json` from the IAU Gazetteer: `build.mjs` (the script), `tiers.mjs` (rows to places and tiers), `readers.mjs` (ZIP, dBase), `curated/`, `promote.json` ([places.md](js/scene/places.md#the-gazetteer)) |
| `js/scene/PickLabels.js` | Label picking and marker display |
| `js/scene/atmos/Atmosphere.js` | Atmosphere mesh + fullscreen post-process pass |
| `js/scene/hdr.js` | The HDR pipeline's tone map (PBR Neutral), its inverse, `sceneReferred` for display-referred materials |
| `js/scene/exposure.js` | Target-keyed exposure; the sky's scale in exposure units |
| `js/scene/evCompensation.js` | The user's exposure compensation in stops: `renderExposure` (keyed × metered gain × 2^EV, the one place it meets the gain), `stepEv`, `clampEv`, `roundEv`, `formatEv` |
| `js/scene/atmos/AtmospherePrecompute.js` | Bruneton transmittance + in-scatter LUT precomputation |

### AR sky view (`js/ar/`)

Pin the camera to a body surface and drive its orientation from device
sensors so the rendered sky overlays the user's real-life view.  The
heavy lifting — the rotating-body parent, the body-fixed lat/lng frame,
the sidereal-rotation animation — already exists for the landed
view; the AR module composes those with a sensor-driven camera→ENU
quaternion to close the loop.

Frame chain (per frame):

```
camera.quaternion =
    enu_to_bodyFixed(lat, lng)   // js/ar/enuFrame.js
  · q_calibration_enu             // js/ar/Calibration.js (optional)
  · q_camera_to_enu               // js/ar/PoseSource.js (sensors)
```

The body-fixed → inertial step is inherited from the scene graph
(camera.platform reparented to the rotating body via `Scene.land`).
ARController.updateFrame writes the composed quaternion AFTER all other
camera-orientation logic in `ThreeUI.renderLoop`, so AR pose always wins
while active.

Stage 1a (current): no camera-passthrough video, atmosphere disabled in
AR mode (`Scene.enterAR` sets `ui._arMode`, `ThreeUI._updateAtmUniforms`
honors it).  Stage 1b enables WebXR when supported.  Stage 1c adds
`navigator.geolocation`.  Stage 1d wires the gear-icon calibration
flow.  Stage 2 adds `<video>` passthrough behind the canvas with
premultiplied-alpha atmosphere blending.

| Path | Role |
|---|---|
| `js/ar/ARController.js` | Lifecycle (enter/exit), per-frame pose compose, calibration capture |
| `js/ar/PoseSource.js` | Pose-source contract + factory; auto-probes WebXR → DeviceOrientation → Null |
| `js/ar/NullPoseSource.js` | Identity-pose fallback (desktop / no sensors) |
| `js/ar/DeviceOrientationPoseSource.js` | W3C DeviceOrientation → camera→ENU quaternion |
| `js/ar/WebXRPoseSource.js` | WebXR `immersive-ar` / viewer-space (stub in stage 1a) |
| `js/ar/enuFrame.js` | `enuTriadAtLatLng`, `enuToBodyFixedQuat` — body-agnostic ENU↔body-fixed math |
| `js/ar/Calibration.js` | Single-vector calibration solver + per-(source, screen-angle) localStorage |
| `js/ui/ARButton.jsx` | Mobile-only entry button + gear toggle when calibration is needed |
| `js/store/ARSlice.js` | Zustand slice tracking active AR state for UI subscriptions |
