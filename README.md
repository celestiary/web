# Celestiary
<img src="screens/ss-Dec-5-2020.png" width="400" style="float: right;"/>

A celestial simulator inspired by Celestia
(http://shatters.net/celestia), written in JS/three.js/GLSL.

A running instance of Celestiary is available at:

https://celestiary.github.io/

## Features
- 9 planets, 20 moons. Accurate major planet orbits
- 106,747 stars, 5,672 names
- 89 constellations
- Time controls for rate and direction of time
- Kinda works on mobile! :)

See [open issues](https://github.com/celestiary/celestiary/issues) page for upcoming features. 

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
The app runs at https://celestiary.github.io/ and is in the celestiary.github.io repo.  From it grab the changes from the web repo and then push them:

```
git pull upstream master
git push
```

## Performance
A first-time session downloads ~3-5MB, mostly of the stars data.  Planet textures are lazy-fetched as the user moves around the scene, but will bring that upwards to ~10MB in full.

Everything is highly cacheable, so subsequent visits are brief HEAD checks on root resources.

Warm load on a local server is 260B in ~300ms (mostly cache checking).  Page rendering finishes by 1s.
