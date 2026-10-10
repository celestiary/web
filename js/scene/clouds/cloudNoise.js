/**
 * The volumetric clouds' noise (CloudVolume.js; atmos/clouds.md): tileable
 * 3D Perlin and Worley noise, combined as Schneider & Vos's "Perlin-Worley"
 * (Schneider & Vos 2015, "The Real-Time Volumetric Cloudscapes of Horizon
 * Zero Dawn", SIGGRAPH Advances in Real-Time Rendering): a low-frequency
 * shape texture whose red channel is Perlin noise with Worley's billows
 * folded in, and whose other channels are Worley at rising frequencies,
 * for the shape's fractal detail; and a high-frequency detail texture of
 * Worley alone, which erodes the shape's edges into wisps.
 *
 * Pure, so it is tested without a GPU, and a generator yields it a slice
 * at a time (sliceSteps), so a browser builds it between frames and the
 * clouds appear when it is done (as the galaxy's map is baked).
 */


/** The shape texture's side, texels; RGBA. */
export const SHAPE_SIZE = 128
/** The detail texture's side, texels; RGBA (the alpha unused). */
export const DETAIL_SIZE = 32

/**
 * Cells per texture side of each channel's noise, so the texture tiles: the
 * shape's Perlin (three octaves from this), its three Worley channels, and
 * the detail's three.
 */
export const SHAPE_PERLIN_CELLS = 4
export const SHAPE_WORLEY_CELLS = [4, 8, 16]
export const DETAIL_WORLEY_CELLS = [2, 4, 8]


// A permutation of 0..255, Perlin's (Perlin 2002, "Improving Noise",
// SIGGRAPH), for the lattice hashes.
const PERM = new Uint8Array(512)
const P = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37,
  240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88,
  237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83,
  111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80,
  73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182,
  189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22,
  39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210,
  144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84,
  204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78,
  66, 215, 61, 156, 180]
for (let i = 0; i < 512; i++) {
  PERM[i] = P[i & 255]
}


/**
 * @param {number} x An integer
 * @param {number} y
 * @param {number} z
 * @param {number} period The lattice's period in each axis
 * @returns {number} A hash in 0..255, periodic
 */
function hash(x, y, z, period) {
  const xi = ((x % period) + period) % period
  const yi = ((y % period) + period) % period
  const zi = ((z % period) + period) % period
  return PERM[xi + PERM[yi + PERM[zi]]]
}


/**
 * @param {number} h A lattice hash
 * @param {number} x Offset from the lattice point
 * @param {number} y
 * @param {number} z
 * @returns {number} The dot product with one of Perlin's 12 gradients
 */
function grad(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y
    case 1: return -x + y
    case 2: return x - y
    case 3: return -x - y
    case 4: return x + z
    case 5: return -x + z
    case 6: return x - z
    case 7: return -x - z
    case 8: return y + z
    case 9: return -y + z
    case 10: return y - z
    case 11: return -y - z
    case 12: return y + x
    case 13: return -y + z
    case 14: return y - x
    default: return -y - z
  }
}


/**
 * @param {number} t 0..1
 * @returns {number} Perlin's quintic fade
 */
function fade(t) {
  return t * t * t * ((t * ((t * 6) - 15)) + 10)
}


/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + ((b - a) * t)
}


/**
 * Perlin gradient noise, periodic.
 *
 * @param {number} x In lattice units
 * @param {number} y
 * @param {number} z
 * @param {number} period Cells per period
 * @returns {number} About −1..1
 */
export function perlin(x, y, z, period) {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const Z = Math.floor(z)
  const fx = x - X
  const fy = y - Y
  const fz = z - Z
  const u = fade(fx)
  const v = fade(fy)
  const w = fade(fz)
  // The lattice's hashes, periodic, from the corner's wrapped coordinates.
  const x0 = ((X % period) + period) % period
  const y0 = ((Y % period) + period) % period
  const z0 = ((Z % period) + period) % period
  const x1 = (x0 + 1) % period
  const y1 = (y0 + 1) % period
  const z1 = (z0 + 1) % period
  const pz0 = PERM[z0]
  const pz1 = PERM[z1]
  const py00 = PERM[y0 + pz0]
  const py10 = PERM[y1 + pz0]
  const py01 = PERM[y0 + pz1]
  const py11 = PERM[y1 + pz1]
  const fx1 = fx - 1
  const fy1 = fy - 1
  const fz1 = fz - 1
  return lerp(
      lerp(lerp(grad(PERM[x0 + py00], fx, fy, fz), grad(PERM[x1 + py00], fx1, fy, fz), u),
          lerp(grad(PERM[x0 + py10], fx, fy1, fz), grad(PERM[x1 + py10], fx1, fy1, fz), u), v),
      lerp(lerp(grad(PERM[x0 + py01], fx, fy, fz1), grad(PERM[x1 + py01], fx1, fy, fz1), u),
          lerp(grad(PERM[x0 + py11], fx, fy1, fz1), grad(PERM[x1 + py11], fx1, fy1, fz1), u), v),
      w)
}


// Each period's feature points, one per cell (featurePoints), kept.
const FEATURES = new Map()


/**
 * @param {number} period Cells per period
 * @returns {Float32Array} The feature point of each cell, offsets from the
 *   cell's corner in 0..1, three per cell, cells in x-fastest order
 */
function featurePoints(period) {
  let points = FEATURES.get(period)
  if (!points) {
    points = new Float32Array(period * period * period * 3)
    let i = 0
    for (let z = 0; z < period; z++) {
      for (let y = 0; y < period; y++) {
        for (let x = 0; x < period; x++) {
          // Three hashes of the cell.
          points[i++] = hash(x, y, z, period) / 255
          points[i++] = hash(x + 31, y + 17, z + 59, period) / 255
          points[i++] = hash(x + 101, y + 73, z + 7, period) / 255
        }
      }
    }
    FEATURES.set(period, points)
  }
  return points
}


/**
 * Worley (cellular) noise, periodic: the distance to the nearest of one
 * feature point per cell, in cell units, inverted so a cell's centre is
 * bright and its edges dark (the billowing look of cumulus).
 *
 * @param {number} x In cell units
 * @param {number} y
 * @param {number} z
 * @param {number} period Cells per period
 * @returns {number} 0..1
 */
export function worley(x, y, z, period) {
  const points = featurePoints(period)
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const Z = Math.floor(z)
  let best = 4
  for (let dz = -1; dz <= 1; dz++) {
    const cz = Z + dz
    const wz = ((cz % period) + period) % period
    for (let dy = -1; dy <= 1; dy++) {
      const cy = Y + dy
      const wy = ((cy % period) + period) % period
      for (let dx = -1; dx <= 1; dx++) {
        const cx = X + dx
        const wx = ((cx % period) + period) % period
        const i = 3 * ((((wz * period) + wy) * period) + wx)
        const ex = x - cx - points[i]
        const ey = y - cy - points[i + 1]
        const ez = z - cz - points[i + 2]
        const d = (ex * ex) + (ey * ey) + (ez * ez)
        if (d < best) {
          best = d
        }
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best))
}


/**
 * @param {number} x 0..1 across the texture
 * @param {number} y
 * @param {number} z
 * @param {number} cells The first octave's cells per side
 * @param {number} octaves
 * @returns {number} Perlin FBM, about −1..1 (each octave halves in weight)
 */
export function perlinFbm(x, y, z, cells, octaves) {
  let sum = 0
  let amplitude = 1
  let norm = 0
  let period = cells
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * perlin(x * period, y * period, z * period, period)
    norm += amplitude
    amplitude *= 0.5
    period *= 2
  }
  return sum / norm
}


/**
 * @param {number} x 0..1 across the texture
 * @param {number} y
 * @param {number} z
 * @param {Array<number>} cellsPerOctave
 * @returns {number} Worley FBM, 0..1, weights 0.625, 0.25, 0.125
 */
export function worleyFbm(x, y, z, cellsPerOctave) {
  const weights = [0.625, 0.25, 0.125]
  let sum = 0
  for (let i = 0; i < cellsPerOctave.length; i++) {
    const c = cellsPerOctave[i]
    sum += (weights[i] ?? 0.125) * worley(x * c, y * c, z * c, c)
  }
  return sum
}


/**
 * Map x from [lo, hi] onto [newLo, newHi], clamped.
 *
 * @returns {number}
 */
export function remap(x, lo, hi, newLo, newHi) {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
  return newLo + ((newHi - newLo) * t)
}


/**
 * One texel of the shape texture: R Perlin-Worley (Perlin FBM remapped so
 * the Worley billows fill its hollows), G, B, A Worley at rising frequency.
 *
 * @param {number} x 0..1
 * @param {number} y
 * @param {number} z
 * @returns {Array<number>} Four values, 0..1
 */
export function shapeTexel(x, y, z) {
  const p = (perlinFbm(x, y, z, SHAPE_PERLIN_CELLS, 3) + 1) / 2
  const [c0, c1, c2] = SHAPE_WORLEY_CELLS
  const w0 = worley(x * c0, y * c0, z * c0, c0)
  const w1 = worley(x * c1, y * c1, z * c1, c1)
  const w2 = worley(x * c2, y * c2, z * c2, c2)
  const wFbm = (0.625 * w0) + (0.25 * w1) + (0.125 * w2)
  // Schneider & Vos: the Perlin dilated by the Worley FBM, so its hollows
  // are filled by the billows.
  const perlinWorley = remap(p, 0, 1, wFbm, 1)
  return [perlinWorley, w0, w1, w2]
}


/**
 * One texel of the detail texture: Worley at three frequencies.
 *
 * @param {number} x 0..1
 * @param {number} y
 * @param {number} z
 * @returns {Array<number>} Three values, 0..1, and 1
 */
export function detailTexel(x, y, z) {
  const [c0, c1, c2] = DETAIL_WORLEY_CELLS
  return [worley(x * c0, y * c0, z * c0, c0), worley(x * c1, y * c1, z * c1, c1), worley(x * c2, y * c2, z * c2, c2), 1]
}


/**
 * Fill a texture's slices, one per step, so a browser can build it between
 * frames: `for (const _ of sliceSteps(...)) {}` runs it all.
 *
 * @param {number} size The texture's side, texels
 * @param {Function} texel (x, y, z in 0..1) → four values in 0..1
 * @param {Uint8Array} out RGBA, size³ × 4
 * @yields {number} The slice just filled
 */
export function* sliceSteps(size, texel, out) {
  for (let z = 0; z < size; z++) {
    let i = z * size * size * 4
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = texel((x + 0.5) / size, (y + 0.5) / size, (z + 0.5) / size)
        out[i++] = Math.round(Math.min(Math.max(v[0], 0), 1) * 255)
        out[i++] = Math.round(Math.min(Math.max(v[1], 0), 1) * 255)
        out[i++] = Math.round(Math.min(Math.max(v[2], 0), 1) * 255)
        out[i++] = Math.round(Math.min(Math.max(v[3], 0), 1) * 255)
      }
    }
    yield z
  }
}


/**
 * Equalise one channel's histogram over a texture, so its values are
 * uniformly distributed over 0..255: then the share of the volume where
 * the channel exceeds 1 − c is c, and the map's coverage c thresholds the
 * shape into clouds that cover c of the sky (CloudVolume.js).
 *
 * @param {Uint8Array} data RGBA
 * @param {number} channel 0..3
 */
export function equalize(data, channel) {
  const histogram = new Uint32Array(256)
  for (let i = channel; i < data.length; i += 4) {
    histogram[data[i]]++
  }
  const count = data.length / 4
  const lookup = new Uint8Array(256)
  let below = 0
  for (let v = 0; v < 256; v++) {
    // The value's rank, taken at the middle of its bin.
    lookup[v] = Math.round(((below + (histogram[v] / 2)) / count) * 255)
    below += histogram[v]
  }
  for (let i = channel; i < data.length; i += 4) {
    data[i] = lookup[data[i]]
  }
}


/**
 * The shape texture: filled slice by slice (steps), then its red channel
 * equalised (equalize) once the slices are done.
 *
 * @param {number} [size]
 * @returns {{data: Uint8Array, size: number, steps: object}} The
 *   texture's buffer and the generator (a slice a step) that fills it
 */
export function shapeNoise(size = SHAPE_SIZE) {
  const data = new Uint8Array(size * size * size * 4)
  const steps = (function* () {
    yield* sliceSteps(size, shapeTexel, data)
    equalize(data, 0)
  })()
  return {data, size, steps}
}


/**
 * @param {number} [size]
 * @returns {{data: Uint8Array, size: number, steps: object}} The detail
 *   texture's buffer and the generator (a slice a step) that fills it
 */
export function detailNoise(size = DETAIL_SIZE) {
  const data = new Uint8Array(size * size * size * 4)
  return {data, size, steps: sliceSteps(size, detailTexel, data)}
}


/** The blue-noise tile's side, texels: it repeats across the march's target. */
export const BLUE_NOISE_SIZE = 64


/**
 * A tiling blue-noise dither tile by void-and-cluster (Ulichney 1993,
 * "The void-and-cluster method for dither array generation"): every rank
 * 0..n−1 once, placed so that at any threshold the texels under it are
 * spread as evenly as a Gaussian of sigma 1.9 can make them, with no
 * low-frequency clumps, which a hash's white noise has, and no stripes,
 * which interleaved gradient noise has.  The march's jitter is this tile's
 * value at the pixel as its phase (CloudVolume.js jitter): its converged
 * mean then carries the tile's pattern at the strength of one sample in
 * JITTER_FRAMES, as grain the eye doesn't track, where the gradient
 * noise's phase printed diagonal hatching into thin cloud.  About 100 ms
 * at 64²; deterministic (seeded).
 *
 * @param {number} [size]
 * @param {number} [seed]
 * @returns {Uint8Array} size² ranks scaled to 0..255, row-major
 */
export function blueNoise(size = BLUE_NOISE_SIZE, seed = 7) {
  const n = size * size
  const sigma = 1.9
  const radius = Math.ceil(sigma * 3)
  const kernel = new Float32Array(((2 * radius) + 1) ** 2)
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      kernel[((dy + radius) * ((2 * radius) + 1)) + dx + radius] = Math.exp(-((dx * dx) + (dy * dy)) / (2 * sigma * sigma))
    }
  }
  const energy = new Float32Array(n)
  const binary = new Uint8Array(n)
  const rank = new Int32Array(n).fill(-1)
  const splat = (i, sign) => {
    const x0 = i % size
    const y0 = (i - x0) / size
    for (let dy = -radius; dy <= radius; dy++) {
      const y = (y0 + dy + size) % size
      for (let dx = -radius; dx <= radius; dx++) {
        const x = (x0 + dx + size) % size
        energy[(y * size) + x] += sign * kernel[((dy + radius) * ((2 * radius) + 1)) + dx + radius]
      }
    }
  }
  // The tightest cluster: the one with the most energy; the largest void:
  // the zero with the least.
  const extreme = (value, most) => {
    let best = -1
    let bestE = most ? -Infinity : Infinity
    for (let i = 0; i < n; i++) {
      if (binary[i] === value && (most ? energy[i] > bestE : energy[i] < bestE)) {
        bestE = energy[i]
        best = i
      }
    }
    return best
  }
  const set = (i, value) => {
    binary[i] = value
    splat(i, value ? 1 : -1)
  }
  // A random tenth to start, then relaxed until the tightest cluster is
  // the largest void.
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const initial = Math.floor(n / 10)
  for (let placed = 0; placed < initial;) {
    const i = Math.floor(random() * n)
    if (!binary[i]) {
      set(i, 1)
      placed++
    }
  }
  for (;;) {
    const cluster = extreme(1, true)
    set(cluster, 0)
    const voidAt = extreme(0, false)
    set(voidAt, 1)
    if (voidAt === cluster) {
      break
    }
  }
  const start = binary.slice()
  // Phase 1: the initial ones ranked down, by removing the tightest cluster.
  for (let r = initial - 1; r >= 0; r--) {
    const cluster = extreme(1, true)
    set(cluster, 0)
    rank[cluster] = r
  }
  // Phase 2: from the initial pattern again, fill the largest void up to half.
  for (let i = 0; i < n; i++) {
    if (start[i]) {
      set(i, 1)
    }
  }
  for (let r = initial; r < n / 2; r++) {
    const voidAt = extreme(0, false)
    set(voidAt, 1)
    rank[voidAt] = r
  }
  // Phase 3: the rest, as the tightest clusters of the zeros, by inverting.
  energy.fill(0)
  for (let i = 0; i < n; i++) {
    binary[i] = 1 - binary[i]
    if (binary[i]) {
      splat(i, 1)
    }
  }
  for (let r = n / 2; r < n; r++) {
    const cluster = extreme(1, true)
    set(cluster, 0)
    rank[cluster] = r
  }
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor(rank[i] * 256 / n)
  }
  return out
}
