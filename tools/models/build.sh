#!/bin/sh
# Rebuilds the bundled spacecraft models under public/large/models/ from
# their sources (js/scene/models.md, "The models": each one's source,
# licence and what this does to it).
#
#   tools/models/build.sh <downloads dir>
#
# The downloads dir holds the sources as fetched (the URLs are below).  The
# glTF-Transform CLI is pinned and run with npx, so it isn't a dependency of
# the app.  optimize decodes Draco, merges the meshes by material (palette,
# join, flatten, instance), welds, prunes, and re-encodes with meshopt and
# quantization, which three's GLTFLoader decodes with MeshoptDecoder (a JS
# module, no wasm file to serve).  It doesn't simplify or touch textures.
set -eu
SRC=${1:?usage: tools/models/build.sh <downloads dir>}
OUT=$(dirname "$0")/../../public/large/models
GT="npx --yes @gltf-transform/cli@4.5.1"

# JWST: NASA 3D Resources' James Webb Space Telescope (A), deployed, from
# NASA Goddard (bldrs-ai/test-models holds a byte-identical copy):
#   https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/james-webb-space-telescope-(a)/James%20Webb%20Space%20Telescope%20(A).glb
# saved as James_Webb_Space_Telescope_A.glb, md5 fd616ecfd267dd60f62fba4f9d30cc7c.
mkdir -p "$OUT/jwst"
$GT optimize "$SRC/James_Webb_Space_Telescope_A.glb" "$OUT/jwst/jwst.glb" \
  --compress meshopt --texture-compress false --simplify false
