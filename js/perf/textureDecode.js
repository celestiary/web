/**
 * Decode the bodies' colour textures from sRGB, for diagnosis (the
 * performance panel's *decode colour textures*, `?decode=1`; HDR.md,
 * "Trying other tone maps").
 *
 * Celestiary lights a texture's stored values as if they were linear (HDR.md,
 * "Colour spaces").  Marking a colour map `SRGBColorSpace` makes three upload
 * it as `SRGB8_ALPHA8`, and the GPU decodes it on every sample, built-in or
 * custom shader alike: the surface is then lit in linear light.  With the
 * output encoded to sRGB too (ThreeUi.setOutputColorSpace), that is the
 * colour-managed pipeline three's own examples use.
 *
 * Only the colour maps of lit materials: `map` and `emissiveMap`, and Earth's
 * night lights (`userData.uNightMap`).  Not their normal, bump, roughness or
 * metalness maps, which are data; not labels, sprites or the unlit points,
 * whose values are display values.  Cesium's layers (Earth up close is
 * Cesium's) can't take a colour space: their imagery layers get gamma 1/2.2
 * instead, which Cesium's globe shader applies as pow(colour, 2.2), sRGB's
 * curve to within its linear toe (setCesiumDecode).  Not a 3D tileset's
 * colours (New York), nor a Cesium guest page's (`?cesium=iframe`).  Only textures with no colour space (NoColorSpace, how the
 * app loads them) are decoded: one already in a colour space (a glTF model's)
 * is left as it is.  Loaded with the panel or the URL's ask, never in the first load.
 */


/** The lit materials' colour slots. */
const SLOTS = ['map', 'emissiveMap']


/**
 * @param {object} t A texture
 * @returns {boolean} Whether it's an 8-bit image texture that could be decoded
 */
function decodable(t) {
  return Boolean(t?.isTexture) && !t.isDataTexture && !t.isRenderTargetTexture && !t.isCompressedTexture &&
    !t.isDepthTexture && !t.isVideoTexture && (t.type === undefined || t.type === 1009)
}


/**
 * @param {object} m A material
 * @returns {boolean} Whether it's one of three's lit materials
 */
function lit(m) {
  return Boolean(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)
}


/** The textures decoded, with the colour space each had. */
const touched = new Map()


/**
 * @param {object} t A texture
 * @param {string} space
 */
function setSpace(t, space) {
  t.colorSpace = space
  // Re-upload only what's loaded: a loading image is uploaded, with its new
  // colour space, when it arrives.
  const img = t.image
  if (img && (img.width ?? 0) > 0 && img.complete !== false) {
    t.needsUpdate = true
  }
}


/**
 * Decode, or stop decoding, the scene's colour textures.  While on, call it
 * again now and then: maps swap in as they load (standInMaps.js).
 *
 * @param {object} scene A three Object3D
 * @param {boolean} on
 * @returns {number} Textures changed by this call
 */
export function setTextureDecode(scene, on) {
  let changed = 0
  if (!on) {
    for (const [t, space] of touched) {
      setSpace(t, space)
      changed++
    }
    touched.clear()
    return changed
  }
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (!lit(m)) {
        continue
      }
      const ts = SLOTS.map((k) => m[k])
      ts.push(m.userData?.uNightMap?.value)
      for (const t of ts) {
        if (!decodable(t) || touched.has(t) || t.colorSpace !== '') {
          continue
        }
        touched.set(t, t.colorSpace)
        setSpace(t, 'srgb')
        changed++
      }
    }
  })
  return changed
}


/** Cesium's gamma for a decode: pow(colour, 1 / gamma) in its globe shader. */
export const CESIUM_DECODE_GAMMA = 1 / 2.2
/** Cesium imagery layers decoded, with the gamma each had. */
const touchedLayers = new Map()


/**
 * Decode, or stop decoding, Cesium's imagery: each imagery layer of each
 * body's widget, by its gamma.  While on, call it again now and then: layers
 * come and go (a month's imagery, the night lights).
 *
 * @param {object} layers CesiumLayers, or its shape: `bodies` by name, each
 *   with a `widget.imageryLayers` once ready
 * @param {boolean} on
 * @returns {number} Imagery layers changed by this call
 */
export function setCesiumDecode(layers, on) {
  let changed = 0
  if (!on) {
    for (const [layer, gamma] of touchedLayers) {
      layer.gamma = gamma
      changed++
    }
    touchedLayers.clear()
    return changed
  }
  for (const body of Object.values(layers?.bodies ?? {})) {
    const list = body?.widget?.imageryLayers
    if (!list || body.widget.isDestroyed?.()) {
      continue
    }
    for (let i = 0; i < list.length; i++) {
      const layer = list.get(i)
      if (layer && !touchedLayers.has(layer)) {
        touchedLayers.set(layer, layer.gamma)
        layer.gamma = CESIUM_DECODE_GAMMA
        changed++
      }
    }
  }
  return changed
}


/** @returns {number} How many textures are decoded now */
export function decodedCount() {
  return touched.size
}


/** @returns {number} How many Cesium imagery layers are decoded now */
export function decodedLayerCount() {
  return touchedLayers.size
}
