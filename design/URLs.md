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

The celestial target, as the loader names it: `#sun`, `#sun/earth`,
`#sun/earth/moon`.  A hash that's just a path still works, and flies to
the target as it always has.

# View

`@` ends the path.  What follows sets the view: a position, then view
params.  Specified in [js/permalink.md](../js/permalink.md).

```
@lat,lng,alt        the camera, in the target's body-fixed frame
t=9233.1234jd       simulation time, days from J2000
cq=x,y,z,w          camera orientation
fov=45deg           field of view
s=al                scene settings not at their defaults, one letter each
```

`s=` holds the scene's toggles (asterisms `a`, labels `l` `p`, orbits `o`,
grids `e` `c` `g`, galaxy `U`, human expansion lines `x`, the HUD `v`),
plus landed `L` and AR `A` (`permalink.js` `SETTINGS_DEFAULTS`).

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
"apps":             the widgets drawer and dock: open, docked, the app
                    showing, the apps pinned and running
"apps.<id>":        one running app's own state, a sub-namespace of apps
"apps.expansion":   the Human Expansion app
```

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
  reload) 1 s after the camera settles, a scene setting changes, or the
  drawer or an app's state changes (`Celestiary._schedulePermalinkUpdate`).
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

# Future work

- A share action that writes a link on demand, with the playing timeline's
  current place, rather than relying on the address bar.
