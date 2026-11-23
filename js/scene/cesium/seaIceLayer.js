/**
 * Earth's sea ice on Cesium's globe (design/Cryosphere.md, phase 1;
 * CESIUM.md, "Sea ice"): the map celestiary's own surface draws
 * (seaice/SeaIceMap.js) as one imagery layer over the months' Blue Marble
 * and its detail, under the night lights: the ice's colour, its
 * concentration in alpha.  Cesium decodes each imagery sample by sRGB's
 * curve before blending (our patch's `imagerySrgb`), so the layer mixes
 * over the ocean in linear light, as the surface's shader does.  It covers
 * land too, where the map is 0 (MUR25 has no data on land, SSMIS's land and
 * coast classes are 0), so it needs no ocean mask of its own; SSMIS's
 * coarser coast puts a fringe of ice on the shore that celestiary's
 * hydrosphere mask clips and this doesn't (Cryosphere.md).
 *
 * In the sea ice's own chunk (SeaIceMap.js re-exports it), so it imports
 * nothing of the first load's: the ice's colour is handed in.
 *
 * Made again when the map's version moves on (a new day): the new layer is
 * added once its picture is in, then the old one goes, so there's no frame
 * without ice.  Its alpha is the map's fade, 0 with the sea ice off.
 */


/**
 * @param {object} body Earth's Cesium body (createWidget's)
 * @param {object} map SeaIceMap
 * @param {boolean} on Whether the sea ice is shown (the 'W' setting)
 * @param {Array<number>} rgb The ice's colour, sRGB bytes (seaIceShader.js SEA_ICE_RGB)
 */
export function syncSeaIceLayer(body, map, on, rgb) {
  const {Cesium, widget} = body
  if (!widget?.imageryLayers || typeof document === 'undefined') {
    return
  }
  body.seaIce ??= {layer: null, url: null, version: 0, building: false}
  const state = body.seaIce
  if (map.version > state.version && !state.building) {
    state.building = true
    const version = map.version
    buildLayer(Cesium, map, rgb).then(({layer, url}) => {
      if (widget.isDestroyed?.()) {
        URL.revokeObjectURL(url)
        return
      }
      const layers = widget.imageryLayers
      const night = body.night && layers.contains(body.night) ? body.night : null
      layer.alpha = state.layer?.alpha ?? 0
      layers.add(layer, night ? layers.indexOf(night) : undefined)
      if (state.layer) {
        layers.remove(state.layer, true)
        URL.revokeObjectURL(state.url)
      }
      Object.assign(state, {layer, url, version})
    }).catch((err) => {
      console.warn('[cesium layer] sea ice layer failed; none on Cesium\'s Earth', err)
      state.version = version
    }).finally(() => {
      state.building = false
    })
  }
  if (state.layer) {
    state.layer.alpha = on ? map.gain() : 0
  }
}


/**
 * @param {object} Cesium
 * @param {object} map SeaIceMap
 * @param {Array<number>} rgb
 * @returns {Promise<{layer: object, url: string}>} A layer of the map's
 *   picture over the whole globe, and the picture's `blob:` URL
 */
async function buildLayer(Cesium, map, rgb) {
  const canvas = document.createElement('canvas')
  canvas.width = map.width
  canvas.height = map.height
  const ctx = canvas.getContext('2d')
  ctx.putImageData(new ImageData(map.rgba(rgb), map.width, map.height), 0, 0)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no PNG from the canvas'))), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  // Credited by the footer while drawn (gibs.js), not Cesium's credit display.
  const provider = await Cesium.SingleTileImageryProvider.fromUrl(url)
  return {layer: new Cesium.ImageryLayer(provider, {alpha: 0}), url}
}

