#!/bin/sh
# Rebuilds the bundled models (spacecraft, and the Rubin telescope) under public/large/models/ from
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

# Rubin: NOIRLab's "Vera C. Rubin Telescope" (model3d004), credit Rubin
# Observatory/NSF/AURA (js/scene/rubin/Rubin.md, "The telescope's model"):
#   https://noirlab.edu/public/media/archives/models3d/model_3d_obj/model3d004.obj
# saved as model3d004.obj (8.4 MB, md5 0b235571cafb1cb1c3f4d32c739e2a9c,
# centimetres, Cinema 4D's export; the
# .mtl it names isn't served, so the materials are the palette below).
# obj2glb.py makes one node a part under three groups the app turns (the
# pier, the azimuth structure, the elevation structure: the regexes are
# the parts' names in the file); optimize keeps that hierarchy (no flatten
# or join) and the materials' colours (no palette texture).  The paint is a
# dielectric (metalness 0.05; the mirror 1): a half-metal under the Sun's
# one point light, with no environment to reflect, was near black by day.
# obj2glb.py winds each face to the file's normals, which face the other
# way from the winding on half of them: a two-sided material lit those
# from the wrong side, black from both.
mkdir -p "$OUT/rubin"
TMP=$(mktemp -d)
python3 "$(dirname "$0")/obj2glb.py" "$SRC/model3d004.obj" "$TMP/rubin-grouped.glb" --scale 0.01 \
  --mat 'mirror=0.25,0.28,0.33,1,0.1' --mat 'Metal - Teflon=0.85,0.85,0.85,0.1,0.4' \
  --mat 'Mat=0.6,0.62,0.65,0.05,0.6' --mat 'Mat_1=0.75,0.76,0.78,0.05,0.55' --mat 'Mat_2=0.35,0.37,0.4,0.05,0.6' \
  --mat 'default=0.7,0.7,0.7,0.05,0.7' --mat 'override=0.5,0.5,0.52,0.05,0.7' \
  --group 'pier=^peer_(?!rails)' \
  --group 'azimuth=base_telescope|^platform_[123]$|^rails$|^stair_rails|^Layer_0_58481|^Cube|^pillar_1$|^ring_base_telescope$|^peer_rails' \
  --group 'elevation=.'
$GT optimize "$TMP/rubin-grouped.glb" "$OUT/rubin/simonyi.glb" \
  --compress meshopt --texture-compress false --simplify false --flatten false --join false --palette false
rm -rf "$TMP"
