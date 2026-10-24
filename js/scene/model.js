import {Box3, DoubleSide, Sphere} from 'three'
import {dataUrl} from '../dataUrl.js'


/**
 * 3D models (glTF) for bodies that aren't spheres: spacecraft first (#25,
 * #120), satellites (#50) and irregular moons and asteroids (#30) next.
 * The whole API is `loadModel`; see js/scene/models.md for the models, their
 * sources and licences, and how they're built.
 *
 *   const model = await loadModel('large/models/jwst/jwst.glb')
 *   node.add(model)  // metres, lit by the Sun like any planet
 *
 * - **The path** is under the site's data (`dataUrl`): models over about
 *   1 MB are in Git LFS under public/large/models/.
 * - **Metres.**  glTF's unit is the metre; `scale` converts a model that
 *   isn't (Celestia's .cmod, once converted, are in km).
 * - **Lit by the Sun**: three's PBR materials under the Sun's PointLight, in
 *   the scene buffer's exposure units, as the planets are (Planet.md,
 *   lighting and exposure).  Emissive is dropped unless `emissive` is set:
 *   NASA's models carry their authoring tool's ambient as emissive, which
 *   lit their night side.
 * - **Thin shells** (a sunshield, a solar array) are often modelled one-sided:
 *   `doubleSided` draws their back faces too, lit by their own side's normal.
 * - **Loaded once.**  Each path is fetched and parsed once for the page
 *   (concurrent asks share it; a failure is forgotten, so the next ask
 *   tries again).  Each call gets a clone, sharing geometry and materials.
 * - **Off the first load.**  GLTFLoader and the meshopt decoder are imported
 *   on the first call, as a chunk of their own.
 *
 * @param {string} path Under the site's data, e.g. 'large/models/jwst/jwst.glb'
 * @param {object} [opts]
 * @param {number} [opts.scale] The model's unit in metres
 * @param {boolean} [opts.emissive] Keep the model's emissive light
 * @param {boolean} [opts.doubleSided] Draw every face from both sides
 * @returns {Promise<import('three').Object3D>} A new clone, scaled to metres
 */
export function loadModel(path, {scale = 1, emissive = false, doubleSided = false} = {}) {
  const key = `${path}${emissive ? '#emissive' : ''}${doubleSided ? '#double' : ''}`
  let parsed = cache.get(key)
  if (!parsed) {
    parsed = loadGltf(dataUrl(path)).then((root) => prepareModel(root, {emissive, doubleSided}))
    parsed.catch(() => cache.delete(key))
    cache.set(key, parsed)
  }
  return parsed.then((root) => {
    const model = root.clone()
    model.scale.setScalar(scale)
    return model
  })
}


/** @type {Map<string, Promise<import('three').Object3D>>} */
const cache = new Map()


/**
 * Forget every loaded model (tests).
 */
export function clearModelCache() {
  cache.clear()
}


/**
 * The loader, set by tests (there's no DOM to decode a model's textures in
 * bun).
 *
 * @type {((url: string) => Promise<import('three').Object3D>)|null}
 */
let gltfOverride = null


/**
 * @param {((url: string) => Promise<import('three').Object3D>)|null} fn
 */
export function setGltfLoader(fn) {
  gltfOverride = fn
}


/**
 * @param {string} url
 * @returns {Promise<import('three').Object3D>} The glTF's scene
 */
async function loadGltf(url) {
  if (gltfOverride) {
    return gltfOverride(url)
  }
  const [{GLTFLoader}, {MeshoptDecoder}] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ])
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return (await loader.loadAsync(url)).scene
}


/**
 * Ready a parsed model for the scene, in place: drop the materials'
 * emissive light (unless asked to keep it), draw both sides if asked, and
 * name it.  A clone shares these materials, so this runs once per load.
 *
 * @param {import('three').Object3D} root
 * @param {object} [opts]
 * @param {boolean} [opts.emissive]
 * @param {boolean} [opts.doubleSided]
 * @returns {import('three').Object3D} root
 */
export function prepareModel(root, {emissive = false, doubleSided = false} = {}) {
  root.name = 'model'
  root.traverse((node) => {
    for (const material of materialsOf(node)) {
      if (!emissive && material.emissive) {
        material.emissive.setRGB(0, 0, 0)
        material.emissiveMap = null
        material.needsUpdate = true
      }
      if (doubleSided) {
        material.side = DoubleSide
        material.needsUpdate = true
      }
    }
  })
  return root
}


/**
 * @param {import('three').Object3D} node
 * @returns {Array<import('three').Material>}
 */
function materialsOf(node) {
  if (!node.material) {
    return []
  }
  return Array.isArray(node.material) ? node.material : [node.material]
}


/**
 * The radius of a model's bounding sphere about its origin, in its parent's
 * units: what a body descriptor's `radius` should be for its model (the
 * zoom's floor and the arrival distance go by it).
 *
 * @param {import('three').Object3D} model
 * @returns {number}
 */
export function modelRadius(model) {
  model.updateMatrixWorld(true)
  const box = new Box3().setFromObject(model, true)
  if (box.isEmpty()) {
    return 0
  }
  // About the origin, not the box's centre: the body's place is the
  // model's origin.
  const sphere = new Sphere()
  box.getBoundingSphere(sphere)
  return sphere.center.length() + sphere.radius
}
