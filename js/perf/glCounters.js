import {SYNC_CALLS} from './counts.js'


/**
 * Counts GL calls by wrapping a context's methods (see counts.js for what is
 * counted).  Installed only under `?perf=1`; without it the context is
 * untouched.  Works on the page's context (three's, and where portal-netgl
 * replays Cesium's calls, those too: it calls the same object's methods) and
 * on Cesium's shadow context.
 */

// The GL enums used: draw modes, framebuffer targets.
const GL = {
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  TRIANGLE_FAN: 0x0006,
  FRAMEBUFFER: 0x8D40,
  DRAW_FRAMEBUFFER: 0x8CA9,
  PIXEL_PACK_BUFFER: 0x88EB,
}
// A full-screen pass is at most a quad, into a viewport of at least this
// share of the canvas.
const FULLSCREEN_MAX_VERTICES = 6
const FULLSCREEN_MIN_AREA = 0.2
const BYTES_PER_PIXEL = 4
const VERTICES_PER_TRIANGLE = 3

const DRAW_FORMS = {
  // name: [index of count, index of instance count (or -1)]
  drawArrays: [2, -1],
  drawElements: [1, -1],
  drawArraysInstanced: [2, 3],
  drawElementsInstanced: [1, 4],
  drawRangeElements: [3, -1],
}
const CLEAR_CALLS = ['clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi']
const UPLOAD_CALLS = [
  'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D',
  'compressedTexImage3D', 'compressedTexSubImage3D',
]
const BLIT_CALLS = ['blitFramebuffer', 'copyTexImage2D', 'copyTexSubImage2D', 'copyTexSubImage3D']


/**
 * @param {number} mode A draw mode
 * @param {number} vertices
 * @returns {number} The triangles it draws
 */
export function trianglesOf(mode, vertices) {
  switch (mode) {
    case GL.TRIANGLES: return Math.floor(vertices / VERTICES_PER_TRIANGLE)
    case GL.TRIANGLE_STRIP:
    case GL.TRIANGLE_FAN: return Math.max(0, vertices - 2)
    default: return 0
  }
}


/**
 * @param {string} name The upload call
 * @param {Array} args Its arguments
 * @returns {number} About how many bytes it moves: the typed array's, or the
 *   image's pixels at four bytes, or (texImage2D, with no data) its width
 *   and height at four
 */
export function uploadBytesOf(name, args) {
  for (const a of args) {
    if (ArrayBuffer.isView(a)) {
      return a.byteLength
    }
  }
  for (const a of args) {
    if (a && typeof a === 'object' && Number.isFinite(a.width) && Number.isFinite(a.height)) {
      return a.width * a.height * BYTES_PER_PIXEL
    }
  }
  const [, , , w, h] = args
  return name === 'texImage2D' && Number.isFinite(w) && Number.isFinite(h) ? w * h * BYTES_PER_PIXEL : 0
}


/**
 * Wrap a context's GL calls to count them into a sink.
 *
 * @param {object} gl A WebGL2 context (or a stand-in with the same methods)
 * @param {import('./counts.js').CountSink} sink
 * @returns {function(): void} Takes the wrappers off again
 */
export function installGlCounters(gl, sink) {
  const undo = []
  const wrap = (name, before) => {
    const original = gl[name]
    if (typeof original !== 'function') {
      return
    }
    const own = Object.prototype.hasOwnProperty.call(gl, name)
    gl[name] = function counted(...args) {
      before(args)
      return original.apply(this ?? gl, args)
    }
    undo.push(() => {
      if (own) {
        gl[name] = original
      } else {
        delete gl[name]
      }
    })
  }
  const viewport = [0, 0, 0, 0]
  let drawFramebuffer = null
  const canvasArea = () => (gl.drawingBufferWidth ?? 0) * (gl.drawingBufferHeight ?? 0)
  const countDraw = (a, countAt, instancesAt) => {
    const vertices = a[countAt]
    const instances = instancesAt < 0 ? 1 : a[instancesAt]
    sink.bump('draws')
    sink.bump('triangles', trianglesOf(a[0], vertices) * Math.max(instances, 1))
    if (vertices <= FULLSCREEN_MAX_VERTICES && instances <= 1 &&
        viewport[2] * viewport[3] >= FULLSCREEN_MIN_AREA * canvasArea()) {
      sink.bump('fullscreen')
    }
  }

  wrap('viewport', (a) => {
    viewport[2] = a[2]
    viewport[3] = a[3]
  })
  for (const [name, [countAt, instancesAt]] of Object.entries(DRAW_FORMS)) {
    wrap(name, (a) => countDraw(a, countAt, instancesAt))
  }
  for (const name of CLEAR_CALLS) {
    wrap(name, () => sink.bump('clears'))
  }
  wrap('bindFramebuffer', (a) => {
    if ((a[0] === GL.FRAMEBUFFER || a[0] === GL.DRAW_FRAMEBUFFER) && a[1] !== drawFramebuffer) {
      drawFramebuffer = a[1]
      sink.bump('fbSwitches')
    }
  })
  wrap('readPixels', (a) => {
    // The last argument: client memory (a stall), or an offset into a pixel-pack buffer.
    if (typeof a[a.length - 1] === 'number') {
      sink.bump('pboReads')
    } else {
      sink.bump('readbacks')
      sink.bumpSync('readPixels')
    }
  })
  for (const name of SYNC_CALLS) {
    if (name !== 'readPixels') {
      wrap(name, () => sink.bumpSync(name))
    }
  }
  wrap('getBufferSubData', (a) => {
    // From a pixel-pack buffer: the second half of a pixel-pack read, taken
    // once its fence has signalled (meterReadback.js), so it waits for no
    // GPU work; at most a round trip.  Any other buffer: a readback.
    if (a[0] === GL.PIXEL_PACK_BUFFER) {
      sink.bumpSync('getBufferSubData')
    } else {
      sink.bump('readbacks')
    }
  })
  wrap('finish', () => sink.bump('readbacks'))
  for (const name of UPLOAD_CALLS) {
    wrap(name, (a) => {
      sink.bump('uploads')
      sink.bump('uploadBytes', uploadBytesOf(name, a))
    })
  }
  for (const name of BLIT_CALLS) {
    wrap(name, () => sink.bump('blits'))
  }
  wrap('useProgram', () => sink.bump('programs'))
  return () => {
    for (const f of undo.reverse()) {
      f()
    }
  }
}
