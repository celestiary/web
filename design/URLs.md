# Design: URLs

Celestiary uses URLs for precise link sharing of the view and the app
state.  A link brings whoever opens it to the same setup: the same target
and time, the camera in the same place, the same scene settings, and the
widgets drawer and its apps as they were, each app with its config.  The
address bar is always that link, kept current as things change.

Modelled on Share's [Design: URLs](https://github.com/bldrs-ai/Share/wiki/Design:-URLs),
whose state-token syntax this follows.

```
https://<host>/<route>#<path>@<position>;<view params>;<state tokens>
```

For example, at the Sun with the Human Expansion app open on a 6-neighbour
spread, halfway along its timeline, with Alpha Centauri A's route drawn:

```
https://celestiary.github.io/web/#sun@12.3,-45.6,20.5Tm;t=9771.1jd;cq=0.1,0.2,0.3,0.927;fov=45deg;apps:open,view=expansion;apps.expansion:k=6,run=1,at=0.5,star=71683
```

# Host and route

- **Host:** `celestiary.github.io` (user page) or `celestiary.github.io/web`
  (project page); PR previews at `celestiary.github.io/web/pr-preview/pr-NNN/`.
- **Route:** the React panels, by path: `/` (none), `/settings`, `/about`,
  `/guide`.  Routes don't touch the hash.

# Path

The target: what the breadcrumb shows, what `c` faces, `g` goes to and `t`
tracks (DESIGN.md [the target](../DESIGN.md#the-target)).  It changes with
every targeting, a click on a label included, so the link always names
it (`js/targetPath.js`):

```
#sun/earth              a body, as the loader names it
#sun/earth/moon         a moon
#sun/earth/new-york     a place on a body: the body's path, then the
                        place's name as a slug (lower case, accents dropped,
                        anything else `-`)
#sun/earth/moon/apollo-11
#hip:32349              a catalogue star, by HIP number (the search's id)
#asterism:ursa-major    an asterism, by its name as a slug
```

- **A place or a body?**  A last segment in the body above's `system` is a
  body; anything else under a body with places (`has_locations`) is a place
  in that body's catalogue.  Bodies win, so every old link means what it
  did.
- **A path alone** goes to the target, as `g` does: a body flies there (as
  it always has), a place lands there, a star travels, an asterism turns
  to face it (from the Sun).
- **With a view** (`@…`, below) the camera is put back where the link had
  it, in its frame, and the target is set without turning it.

## The camera's frame, `from=`

The view's position and `cq` are in the frame of the body the camera is
at (Celestiary `permalink()`): the path's body, or the place's body, unless
`from=` names another.  Targeting changes the path and `from`, never the
camera or its frame:

```
#sun/earth@30.26,-97.75,400km;t=…           at Earth, Earth the target
#sun/earth/austin@30.26,-97.75,400km;t=…    the same view, Austin targeted
#sun/jupiter@30.26,-97.75,400km;from=sun/earth;t=…
                                            the same view, Jupiter targeted
#hip:32349@30.26,-97.75,400km;from=sun/earth;t=…
                                            the same view, Sirius targeted
#hip:32349@0,12.5,1.2Tm;t=…                 at Sirius (gone there), its target
```

`from=` is a body's path or a star's (`hip:N`: the camera went to that
star; its frame's axes are the scene's, its radius the star's).  It's left
out when it would name the path's own body.

Why not re-express the camera in the target's frame instead: a body's
frame far from the camera loses it (4 decimal places of a degree is 2,300
km at Saturn's distance from Earth, and the altitude's 6 significant
figures 1,000 km at a Tm), a star or an asterism has no frame to give a
landed camera, and the reloaded camera would ride the target's orbit, not
the body it was at.

## The target survives a reload

The path is the target, so a target picked in the search, by the Look at
button, a click or the keys is in the link a second after it is picked
(`Celestiary._schedulePermalinkUpdate`, run from `Scene.onTargetChange`, and
again when a look tween ends), and a reload sets it again once the stars or
the places it needs have loaded.  No separate token is needed: the path
says what is targeted and `from=` where the camera is.  A view of Europa
from Earth, then HIP 46635 targeted with the search's Look at:

```
#sun/jupiter/europa@41.2054,-82.3901,169m;from=sun/earth;t=9774.8983jd;cq=…;fov=0.07deg
#hip:46635@41.2054,-82.3901,169m;from=sun/earth;t=9774.8984jd;cq=…;fov=0.07deg
```

(`cq` differs between the two because Look at turned the camera; a click
doesn't.)  Unnamed catalogue stars are the same as named ones: the path
is the HIP number (`hip:` plus the search's id), whichever name the search
matched.  Tracking (`t`) and following (`f`) are the pieces of targeting
state that are not the target: they are the `T` and `F` settings, below.

## Old links

A link with no `from=` and a body path is read as it always was: the path
is the target and the frame.  A path that doesn't resolve (a place not in
the catalogue, a star not in it) restores the view with the frame's body
as the target.

# View

`@` ends the path.  What follows sets the view: a position, then view
params.  Specified in [js/permalink.md](../js/permalink.md).

```
@lat,lng,alt        the camera, in its frame's body-fixed frame
from=sun/earth      the camera's frame, when not the path's body (above)
t=9233.1234jd       simulation time, days from J2000
cq=x,y,z,w          camera orientation
fov=45deg           field of view
ev=1.33             exposure compensation, stops over the metered exposure
                    (left out at 0)
sm=1.5              the stars' setting, magnitudes over the naked eye's
                    limit (left out at 0)
s=al                scene settings not at their defaults, one letter each
```

`s=` holds the scene's toggles (asterisms `a`, labels `l` `p`, orbits `o`,
grids `e` `c` `g`, galaxy `U`, human expansion lines `x`, the HUD `v`),
plus landed `L`, tracking `T`, following `F` and AR `A` (`permalink.js`
`SETTINGS_DEFAULTS`).  `T` is the `t` key: the camera keeps the target
centred every frame, so a link made while tracking reloads tracking.  `F`
is the `f` key (`Scene.follow`, `Shared.targets.follow`): following the
targeted body's orbit.  It is the key's state, whatever the key does (today
nothing reads it: DESIGN.md [camera controls](../DESIGN.md#camera-controls)),
and independent of `T` (`s=TF` is both).  A link made while following reloads
following, the body being the link's target, set after it as `T` is.
A letter is a flip of the toggle's default, not "on": `a`, `l`, `p`, `o`,
`U`, `x` and `v` are on by default, so their letters mean off (`s=loL` is
star labels off, orbits off, landed), while `e` `c` `g` `L` `T` `F` `A` mean on.
A link from before `F` has no such letter and reloads not following.

`fov=` is written to four significant figures (`45deg`, `0.0714deg`,
`120.5deg`), so a telescope's field survives the round trip to a part in
2,000: two decimal places would turn 0.0714 into 0.07 (2% off) and any
field under 0.005 degrees into 0, a camera that cannot draw.  A hand-written
field is held to 0.0001 to 179 degrees.

`ev=` is the user's exposure compensation (`[` and `]` are the stars; `-`
and `=` step it a third of a stop, `e` resets it: DESIGN.md
[camera controls](../DESIGN.md#camera-controls)), written in stops to two
decimal places and left out at 0, so a link at the metered exposure is
just the view.  It's read with or without a `+` (`ev=+1.3`, as a camera
shows it), held to ±10 stops, and 0 when it isn't a number.  It's a view
param, not a state token: it belongs with `fov`, the other half of how the
frame is framed, and loads with the view on every link, not on the first
load only.

```
#…;fov=0.91deg;ev=1.33;s=oL     a third of a stop over a stop, brighter
```

`sm=` is the stars' setting, the `[` and `]` keys (the user's "exposure for
just the stars": the limiting magnitude, 6.5 at the naked eye's).  It is the
limit's offset from the naked eye's, in magnitudes, so 0 is the default for
it as for `ev=`: it is left out at 0, the key presses step it by half a
magnitude (`[` fewer stars, `]` more), the screen shows it as `Stars +1.0 mag`
for two seconds, as `EV +1.3` shows the exposure, and stepping back to 0
lands on exactly 0 (the offset is held, not the star gain, which is 10^(0.4 ×
offset) and has no exact inverse).  It is in magnitudes, not stops, because
the control is a limiting magnitude and each press is half of one, as in
Celestia; a stop of light would be 0.753 mag, a step off the halves.  Read
with or without a `+`, held to ±10, and 0 when absent or not a number; two
decimal places, as `ev=`.  It is a view param for the reason `ev=` is.

```
#…;fov=0.91deg;ev=1.33;sm=1.5;s=oL   brighter, with 1.5 mag more stars
```

The view params predate state tokens and keep their `key=value` form.

# State Tokens

Everything else, the app state, is in state tokens after the view, as in
Share.

## Syntax

```
;   token separator
:   label-value separator
,   list of values separator
=   named value assignment
+   list within a named value

e.g.
#sun@0,0,1Tm;t=0jd;cq=0,0,0,1;fov=45deg;apps:open,dock,pin=expansion
```

- A token's value is a `,` list of **flags** (`open`) and **named values**
  (`view=expansion`).  A named value that's a list joins with `+`
  (`pin=a+b`).
- Names and values are plain: letters, digits, `.`, `-` and `_`.  Numbers
  have at most 4 decimal places, trailing zeros trimmed.
- A token with no value, e.g. `apps:`, marks its panel open (Share's rule).
- Telling a token from a view param: in `label:value` the `:` comes before
  any `=`; a view param has no `:`.
- **Only what differs from the defaults is written.**  A token with
  nothing to say is left out, so a link at the defaults is just the view.
- **Unknown tokens, names and app IDs are ignored**; a bad or out-of-range
  value is its default, or held to its control's range.  So links from a
  newer or older build still open.

## Feature State Tokens

Each feature has its own label:

```
"time":             the clock, when it is paused or not at real time
"apps":             the widgets drawer and dock: open, docked, the app
                    showing, the apps pinned and running
"apps.<id>":        one running app's own state, a sub-namespace of apps
"apps.expansion":   the Human Expansion app
```

### Time Token

The clock (`Time.js`): paused, and the rate it runs at.

```
pause              the clock is paused
rate=<n>           the rate, a signed multiplier on real time: 8 is eight
                   times, -2 is backwards at twice (default 1)
```

```
#…;t=9774.8984jd;…;time:pause                paused at that date
#…;t=9774.8984jd;…;time:rate=8               running at 8x
#…;t=9774.8984jd;…;time:pause,rate=-4        paused, resuming at 4x backwards
```

Decisions:

- **Paused restores as paused, at `t=`.**  The clock does not run from the
  link's date on load, so what was on screen when the link was copied is on
  screen when it opens, and a moment (an occultation, a transit) can be
  shared.  Unpausing runs from there.
- **The rate is in the link, and is the one in force.**  A paused clock keeps
  its rate (`j`, `k` and `l` set it while paused), so a link made paused at
  8x resumes at 8x.  Real time (1) is the default and left out, and so is a
  clock that is running at it, so the common link has no token.
- **The rate is the multiplier, not Time's step count.**  The keys reach
  only signed powers of two (`Time.timeScale`, up to 2^40), so the value is an
  integer and reads as "8x"; a hand-written one snaps to the nearest power
  of two (`Time.setRate`).  (Real time run backwards, `-1`, is a rate too:
  `j` on real time gives it.)
- **It belongs in a state token, not with the view params:** how the clock
  runs is app state, not how the camera frames the scene, and the
  view params are the camera's.
- **A link restores the clock whole**, as it does `ev=`: on every link with a
  view, one without a `time:` token runs at real time, so a link made running
  and opened in a tab that is paused or at 8x opens running.
- **The `cq=` rule stays.**  A link restores its time and view only when it
  has a view (`@…;t=;cq=;fov=`), and the clock token is part of the view's
  restore, so a path-only link, or one without `cq=`, still opens at the
  current time at the current rate, going to its target.  Nothing needed the
  rule changed: a link without a camera orientation isn't a view of anything
  in particular, so there's no moment to hold still.

The link is rewritten when the clock is paused, its rate set, or its date
set (`Time.onTimeScaleChange`), as well as when the camera settles.  While
it is running the link's `t=` is the date at the last rewrite, so a copied
link may be a moment behind; paused it is exact.

### Apps Token

The widgets drawer (DESIGN.md
[widgets drawer and dock](../DESIGN.md#widgets-drawer-and-dock)): open or
closed, the dock, the tray or one app showing, and which apps run and
which are pinned.

```
open               the drawer is open
dock               docked: the dock bar shows even with no app pinned
view=<id>          the app showing (else the tray)
pin=<id>+<id>      pinned apps: they run with the drawer closed, in the dock
run=<id>+<id>      other running apps: neither pinned nor showing (opened,
                   then back to the tray)
```

Every app it names is running: the ones in `pin`, `run` and `view`.  With
the drawer closed only pinned apps run, as closing the drawer stops the
others.

```
#…;apps:open                           the drawer open on the tray
#…;apps:                               the same, Share's bare form
#…;apps:open,view=expansion            open on the Human Expansion app
#…;apps:view=expansion,pin=expansion   closed, the app pinned in the dock
#…;apps:dock                           docked, the drawer closed
#…;apps:open,run=expansion             open on the tray, the app running
```

No `apps` token: the drawer closed, undocked, nothing running.

## Application State Tokens

Each running app writes its state as its own token, `apps.<id>:`, under
the `apps` namespace, so apps don't collide with each other or with the
features above.  An app that isn't running writes none, and its state is
dropped when it stops.  An app with nothing off its defaults writes none
either; `apps` alone says it's running.

Small state is encoded directly in the token, as here.  Larger state would
go in a store (IndexedDB, a backend), keyed by the token, as Share
describes; none does yet.

### Human Expansion Token

`apps.expansion:` (scene/Colonization.md).  Every control in the app's
panel, and the run on screen:

```
Model
c=0.5          speed, fraction of c
k=10           nearest neighbours per star
delay=100      launch delay per colony, years
dur=30         playback duration, seconds

Run and timeline
run=1          a spread has been computed (with c, k and delay above)
at=0.4321      the place on the timeline, 0 to 1 (with run)
play=1         playing (with run)
pace=years     pace the timeline by years (default: by stars)

Selected star
star=71683     the star whose route from the Sun is drawn, by HIP number

Lines
w0=5           width at the first hop, px
w1=0.5         width at the last hop, px
op=0.25        opacity
atten=0        size attenuation off (default on)
full=32        size attenuation's full-width distance, ly

Pulse
pulse=1        pulse on (default off)
T=0.05         seconds per hop
N=10           trail, hops
```

The values shown are the defaults, so none of them would be written.
Booleans are `=1` and `=0`.  The show-lines switch is the scene setting
`x`, in `s=`.

```
#…;apps:open,view=expansion;apps.expansion:run=1,at=0.5
    the default spread, halfway (by stars), paused
#…;apps:view=expansion,pin=expansion;apps.expansion:k=6,delay=500,run=1,at=1,star=70890
    pinned with the drawer closed: a 6-neighbour, 500-year-delay spread,
    finished, Proxima's route drawn
#…;apps:open,view=expansion;apps.expansion:w0=12,w1=2,op=1,pulse=1,N=0
    no run yet; wide, opaque lines and a pulse without a trail set up
```

Restoring a run recomputes it from `c`, `k` and `delay` once the stars have
loaded (a second or two), then puts it back at `at`, playing or not.  The
spread is deterministic, so it's the same one.  While it plays, the link
keeps the place it started playing from, and is brought up to date when it
stops.

The model parameters written are the run's.  Fields edited since but not
yet run aren't in the link.

# Reading and writing

- **Writing.**  The address bar is rewritten (`history.replaceState`, no
  reload) 1 s after the camera settles, the target, a scene setting, the
  exposure, the stars' setting or the clock changes, or the drawer or an
  app's state changes (`Celestiary._schedulePermalinkUpdate`).
  The drawer state and the apps' states are in the widgets slice
  (store/WidgetsSlice.js); `store/appTokens.js` turns them into tokens and
  back.
- **Reading.**  On the first load only, as with the scene settings: the
  `apps` token restores the drawer at once, and each running app starts
  from its token, waiting for what it needs.  Moving to another target
  later (a new hash) leaves the drawer as it is.

## Adding an app's state

1. Keep the app's state somewhere the token can be written from: report it
   with `dispatchWidgets({type: 'appState', id, appState})` as it changes,
   and start from `widgets.appStates[id]` when the panel mounts.
2. Write its codec, `encode(state)` → the token's value or null, and
   `decode(value)` → a whole state (defaults for what's missing or bad).
   Register it in `APP_CODECS` (store/appTokens.js) under the app's ID.
3. Document the token here.

# What a link restores

An audit of what a viewer can change that changes what is seen.  A link
brings back all of the first group.

**Restored**
- the target and the camera's frame (path, `from=`), position, orientation
  (`cq=`), field of view (`fov=`);
- the date (`t=`), the clock's pause and rate (`time:`);
- the exposure compensation (`ev=`) and the stars' setting (`sm=`);
- the scene toggles (`s=`): asterisms, star and planet labels, orbits, the
  three grids, the Milky Way, human expansion lines, the HUD (`v`), landed
  (`L`), tracking (`T`), following (`F`), AR (`A`);
- the widgets drawer, the dock, the apps pinned and running, and each app's
  controls and run (`apps`, `apps.<id>`);
- the page's query string (`?hdr=0`, `?perf=1`), kept when the address bar
  is rewritten.

**Added with this audit:** `time:`, `sm=`, `T`, and the telescope-safe `fov=`.  `F` followed ([#102](https://github.com/celestiary/web/issues/102)).

**Left out, deliberately**
- *Cesium or celestiary's own rendering for Earth, the Moon and Mars*
  (the layers control, `bodyLayers`).  It changes what is seen, and is a
  small token (`layers:earth=default`), but it needs Cesium ion to verify
  and belongs with the layers work (CESIUM.md); left to a follow-up.
- *Drag mode* (`m`: auto, pan, orbit): how the pointer moves the camera, not
  what is seen, and `goTo` resets it.
- *Presentation mode* (`V`): the toggles it sets are in `s=`; the snapshot
  it keeps to restore them is transient.
- *The performance panel and the AR debug HUD*: developer tools.
- *The search box's text and results, the open settings, about and guide
  panels (routes), the tooltips and any dialog*: transient UI.

# Future work

- A share action that writes a link on demand, with the playing timeline's
  current place, rather than relying on the address bar.
