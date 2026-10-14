# Celestiary
<img src="screens/ss-Dec-5-2020.png" width="400" style="float: right;"/>

A celestial simulator inspired by Celestia
(http://shatters.net/celestia), written in JS/three.js/GLSL.

A running instance of Celestiary is available at:

https://celestiary.org/

## Features
- 9 planets, 20 moons. Accurate major planet orbits
- 106,747 stars, 5,672 names
- 89 constellations
- Time controls for rate and direction of time
- Kinda works on mobile! :)

See [ROADMAP.md](ROADMAP.md) for what's planned and in what order, and
the [epics](https://github.com/celestiary/web/issues?q=is%3Aopen+label%3Aepic)
for the work in each area.

## Design

See [DESIGN.md](DESIGN.md)

## Development
```
yarn install
yarn test
yarn serve
# Visit http://localhost:8080/
```

Edits in the source directory will be available in the app on a page refresh.

For larger changes, it's also a good idea to step through the guide pages (in /guide) to make sure they'll all working.

## Deploy
The app is served at https://celestiary.org/ (the user page,
`celestiary/celestiary.github.io`, with celestiary.org as its custom domain).
The old `celestiary.github.io` addresses redirect there.  It deploys
automatically on push to `main` from this repo:

- `.github/workflows/deploy-prod.yml` builds with `BASE_PATH=/` and pushes
  to `celestiary/celestiary.github.io`'s `gh-pages` branch via an SSH deploy
  key (secret `CELESTIARY_GITHUB_IO_DEPLOY_KEY`), serving the user page.
  Its build writes `CNAME` (the custom domain, which the deploy would
  otherwise wipe), `robots.txt` and `sitemap.xml` (`esbuild/site.js`).

This repo's own Pages site, at `celestiary.org/web/`, hosts the PR previews,
at `celestiary.org/web/pr-preview/pr-NNN/` via
`.github/workflows/pr-preview.yml`.  The rest of `/web/` is a stub
(`.github/workflows/gh-pages.yml`) that sends old `/web/` links to the root,
query and `#` fragment kept.  See DESIGN.md, "Hosting and the domain".

## Performance
A first-time session downloads ~3-5MB, mostly of the stars data.  Planet textures are lazy-fetched as the user moves around the scene, but will bring that upwards to ~10MB in full.

Everything is highly cacheable, so subsequent visits are brief HEAD checks on root resources.

Warm load on a local server is 260B in ~300ms (mostly cache checking).  Page rendering finishes by 1s.
