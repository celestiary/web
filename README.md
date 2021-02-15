# Celestiary
<img src="screens/ss-Dec-5-2020.png" width="400" style="float: right;"/>

A celestial simulator inspired by Celestia
(http://shatters.net/celestia), written in JS/three.js/GLSL.

A running instance of Celestiary is available at:

https://celestiary.github.io/


## Features
- Keplerian orbits (6 orbital elements)
- Time controls, to alter rate and direction of time
- Star colors based on surface temperatures
- Star surface dynamics simulation (Perlin noise in black-body spectra)
- 9 planets, 20 moons
- Permalinks for positions
- Howto guide for programming topics used in the app (see help/? screen in the app for the live howto guide)
- Even kinda works on mobile! :)

Celestia datasets:
- ~100,000 stars
- ~3k star names
- ~80 Asterisms/constellations

See [open issues](https://github.com/celestiary/celestiary/issues) page for upcoming features. 

## Get
This project uses submodules, so make sure to get them when cloning:
```
> git clone --depth=1 --recurse-submodules https://github.com/celestiary/celestiary
```
This will download about 60MB, with the current directory being ~20MB, mostly in textures/.  I'll probably filter most of the older versions in git soon.

## Development
Celestiary is a static web app, and may be served directly out of its root.

For live editing, change the script tag that loads the app in index.html, from js/bundle.js to js/index.js.

See the following section to recreate the bundle.js.

## Build (optional)
The live site uses a JS bundle efficiency.  To generate and test with it:
```
~/celestiary/> cd js
~/celestiary/js> npx rollup index.js --file bundle.js

index.js → bundle.js...
created bundle.js in 2.4s
```
The bundle.js file is referenced only in index.html in the script include.  Switch that to js/index.js for live source editing.

## Test
There are a few tests in files ending in: \_test.js
```
~/celestiary/js> for f in *_test.mjs ; do echo $f ; node $f ; done
AsterismsCatalog_test.mjs
TOTAL OK: 1, FAIL: 0, ASSERTS: 2
StarsCatalog_test.mjs
TOTAL OK: 3, FAIL: 0, ASSERTS: 3
```
For larger changes, it's also a good idea to step through the guide pages (in /howto) to make sure they'll all working.

## Run
Run a web server in the root directory and load index.html from there.
The project includes https://github.com/pablo-mayrgundter/http, e.g.:
```
~/celestiary> java/http/net/http/serve.sh
net.http.Server.port=8080
net.http.Server.log=true
net.http.Server.index=index.html
net.http.Server.ssl=false
...
```
Alternatively with Node's http-server package:
```
~/celestiary> npx http-server -p 8080
Starting up http-server, serving ./
Available on:
  http://127.0.0.1:8080
  http://10.0.0.3:8080
Hit CTRL-C to stop the server
```

Now visit http://localhost:8080/index.html in your browser

## Performance
A first-time session downloads ~3-5MB, mostly of the stars data.  Planet textures are lazy-fetched as the user moves around the scene, but will bring that upwards to ~10MB in full.

Everything is highly cacheable, so subsequent visits are brief HEAD checks on root resources.

Warm load on a local server is 260B in ~300ms (mostly cache checking).  Page rendering finishes by 1s.
