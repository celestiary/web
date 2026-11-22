import {CanvasTexture} from 'three'


// No data told from a saturated core, in the tiles of a survey served as a
// negative (ESASky's Hubble jpegs: Sky.md, "Saturated cores").  Both are
// black as served: where the survey has nothing, and where a star or a
// nucleus saturated (white in the negative shown).  Keying black out cut
// the cores out with the no data: the Sombrero's nucleus and its bulge
// showed the sky under them (the maintainer's look at the preview).  The
// texel can't tell them apart; its neighbourhood can: a saturated core sits
// in the dark of its object, no data borders the survey's light sky.  So
// the tile's pixels are read once, as it loads, and the no data is given
// alpha 0; the material then needs no key.

/** With no manifest ramp, the value (counts) up to which a pixel is black. */
export const BLACK_COUNTS = 16
/**
 * A black region is a saturated core where the data round it, REACH_PX out
 * from its edge, has a median under this (counts, as served): the dark of a
 * bright object.  The survey's sky is 100 and more (Sky.md).
 */
export const DARK_COUNTS = 72
/** How far from a black region's edge its surround is read: past the jpeg's ringing. */
export const REACH_PX = 2
/** A black region this small, not at the tile's edge, is a star's core whatever is round it. */
export const SMALL_PX = 100
/** The no data is widened this far: the blend at the edge of the data shows as a bright rim in the negative. */
export const WIDEN_PX = 4

const DX = [1, -1, 0, 0]
const DY = [0, 0, 1, -1]


/**
 * A tile's pixels with its no data made clear, in place: alpha 0 and white
 * (black in the negative, so a filtered edge blends to dark), the saturated
 * cores left black and opaque.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba The tile's pixels, rows of RGBA
 * @param {number} w
 * @param {number} h
 * @param {object} [opts]
 * @param {number} [opts.black] BLACK_COUNTS, or the manifest's
 * @returns {{noData: number, saturated: number}} Pixels of each (before widening)
 */
export function clearNoData(rgba, w, h, {black = BLACK_COUNTS} = {}) {
  const n = w * h
  // 0 unseen, 1 queued or saturated, 2 no data.
  const state = new Uint8Array(n)
  const queue = new Int32Array(n)
  const hist = new Uint32Array(256)
  const isBlack = (i) => rgba[i * 4] <= black
  let noData = 0
  let saturated = 0
  for (let start = 0; start < n; start++) {
    if (state[start] !== 0 || !isBlack(start)) {
      continue
    }
    let head = 0
    let tail = 0
    queue[tail++] = start
    state[start] = 1
    hist.fill(0)
    let samples = 0
    let atEdge = false
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]
        const ny = y + DY[k]
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          atEdge = true
          continue
        }
        const j = (ny * w) + nx
        if (isBlack(j)) {
          if (state[j] === 0) {
            state[j] = 1
            queue[tail++] = j
          }
          continue
        }
        // The data round the region: REACH_PX further out, past the ringing.
        const sx = Math.min(w - 1, Math.max(0, x + (DX[k] * REACH_PX)))
        const sy = Math.min(h - 1, Math.max(0, y + (DY[k] * REACH_PX)))
        const s = (sy * w) + sx
        if (!isBlack(s)) {
          hist[rgba[s * 4]]++
          samples++
        }
      }
    }
    let core = !atEdge && tail <= SMALL_PX
    if (!core && samples > 0) {
      let seen = 0
      let median = 0
      while (median < 255 && (seen += hist[median]) * 2 < samples) {
        median++
      }
      core = median < DARK_COUNTS
    }
    if (core) {
      saturated += tail
      continue
    }
    noData += tail
    for (let q = 0; q < tail; q++) {
      state[queue[q]] = 2
    }
  }
  if (noData === 0) {
    return {noData, saturated}
  }
  for (let pass = 0; pass < WIDEN_PX; pass++) {
    let tail = 0
    for (let i = 0; i < n; i++) {
      if (state[i] === 2) {
        continue
      }
      const x = i % w
      const y = (i - x) / w
      if ((x > 0 && state[i - 1] === 2) || (x < w - 1 && state[i + 1] === 2) ||
          (y > 0 && state[i - w] === 2) || (y < h - 1 && state[i + w] === 2)) {
        queue[tail++] = i
      }
    }
    for (let q = 0; q < tail; q++) {
      state[queue[q]] = 2
    }
  }
  for (let i = 0; i < n; i++) {
    if (state[i] === 2) {
      const o = i * 4
      rgba[o] = 255
      rgba[o + 1] = 255
      rgba[o + 2] = 255
      rgba[o + 3] = 0
    }
  }
  return {noData, saturated}
}


/**
 * A loaded tile's texture with its no data clear (clearNoData), or null
 * where the pixels can't be read (no DOM, as in the tests; a tainted
 * image): the caller then keys black, as before.
 *
 * @param {object} texture A three Texture, its image loaded
 * @param {object} [opts] clearNoData's
 * @returns {?object} A CanvasTexture, the given texture disposed
 */
export function noDataCleared(texture, opts) {
  const image = texture?.image
  const w = image?.naturalWidth ?? image?.width
  const h = image?.naturalHeight ?? image?.height
  if (typeof document === 'undefined' || !(w > 0 && h > 0)) {
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', {willReadFrequently: true})
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, w, h)
    clearNoData(data.data, w, h, opts)
    ctx.putImageData(data, 0, 0)
    const out = new CanvasTexture(canvas)
    // The white under the clear pixels is kept as written, for the filter.
    out.premultiplyAlpha = false
    texture.dispose?.()
    return out
  } catch {
    return null
  }
}
