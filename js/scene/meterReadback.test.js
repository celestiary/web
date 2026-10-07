import {describe, expect, it} from 'bun:test'
import {
  EXPOSURE_TAU_SECONDS, METER_EVERY_FRAMES, METER_GAIN_MAX, METER_KEY, adaptMeterGain, easeExposure, meanLogLuminance,
  meteredGain,
} from './exposure.js'
import {AsyncReadback, METER_RING_SIZE, asyncReadbackSupported} from './meterReadback.js'


const SIZE = 32
const PIXELS = SIZE * SIZE
const SIGNALED = 0x9119
const UNSIGNALED = 0x9118


/**
 * A stand-in WebGL2 context: a framebuffer whose pixels the test sets,
 * pixel-pack buffers that readPixels copies them into, and fences that
 * signal when the test says the GPU has got there.
 *
 * @returns {object}
 */
function fakeGl() {
  const gl = {
    PIXEL_PACK_BUFFER: 0x88EB,
    calls: [],
    framebuffer: new Float32Array(PIXELS * 4),
    bound: null,
    // Fences up to this one have signalled.
    signalledUpTo: 0,
    fences: 0,
    live: new Set(),
  }
  gl.createBuffer = () => ({data: null})
  gl.deleteBuffer = () => {}
  gl.bindBuffer = (target, buffer) => {
    gl.bound = buffer
  }
  gl.bufferData = (target, bytes) => {
    gl.bound.data = new Float32Array(bytes / 4)
  }
  gl.readPixels = (x, y, w, h, format, type, dest) => {
    gl.calls.push(typeof dest === 'number' ? 'readPixels-pbo' : 'readPixels')
    gl.bound.data.set(gl.framebuffer)
  }
  gl.fenceSync = () => {
    const sync = {id: ++gl.fences}
    gl.live.add(sync)
    return sync
  }
  gl.getSyncParameter = (sync) => (sync.id <= gl.signalledUpTo ? SIGNALED : UNSIGNALED)
  gl.deleteSync = (sync) => gl.live.delete(sync)
  gl.getBufferSubData = (target, offset, dest) => {
    gl.calls.push('getBufferSubData')
    dest.set(gl.bound.data)
  }
  return gl
}


describe('asyncReadbackSupported', () => {
  it('needs WebGL2 sync objects and buffer reads', () => {
    expect(asyncReadbackSupported(fakeGl())).toBe(true)
    // WebGL1: no fences, no getBufferSubData.
    expect(asyncReadbackSupported({createBuffer: () => ({}), readPixels: () => {}})).toBe(false)
    expect(asyncReadbackSupported(null)).toBe(false)
  })
})


describe('AsyncReadback', () => {
  it('returns nothing until the fence signals, then the pixels and what was kept with them', () => {
    const gl = fakeGl()
    const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
    gl.framebuffer.fill(0.25)
    expect(rb.issue({gain: 2}, 10)).toBe(true)
    // The framebuffer moves on; the read already has its pixels.
    gl.framebuffer.fill(9)
    expect(rb.poll(10)).toBeNull()
    expect(rb.poll(11)).toBeNull()
    gl.signalledUpTo = 1
    const reading = rb.poll(12)
    expect(reading.meta).toEqual({gain: 2})
    expect(reading.latency).toBe(2)
    expect(reading.pixels[0]).toBe(0.25)
    expect(reading.pixels[(PIXELS * 4) - 1]).toBe(0.25)
    expect(rb.inFlight).toBe(0)
    expect(gl.live.size).toBe(0)
    // Never a readPixels into client memory.
    expect(gl.calls).toEqual(['readPixels-pbo', 'getBufferSubData'])
  })

  it('takes only the newest finished read, and drops the older unread', () => {
    const gl = fakeGl()
    const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
    for (let i = 1; i <= 3; i++) {
      gl.framebuffer.fill(i)
      rb.issue({n: i}, i)
    }
    gl.signalledUpTo = 2
    const reading = rb.poll(5)
    expect(reading.meta).toEqual({n: 2})
    expect(reading.pixels[0]).toBe(2)
    expect(gl.calls.filter((c) => c === 'getBufferSubData').length).toBe(1)
    expect(rb.inFlight).toBe(1)
    gl.signalledUpTo = 3
    expect(rb.poll(6).meta).toEqual({n: 3})
    expect(rb.poll(7)).toBeNull()
  })

  it('skips a read with every buffer in flight, never waits', () => {
    const gl = fakeGl()
    const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
    for (let i = 0; i < METER_RING_SIZE; i++) {
      expect(rb.issue({n: i}, i)).toBe(true)
    }
    expect(rb.canIssue()).toBe(false)
    expect(rb.issue({n: 99}, 9)).toBe(false)
    expect(rb.skipped).toBe(1)
    expect(rb.inFlight).toBe(METER_RING_SIZE)
    gl.signalledUpTo = 1
    expect(rb.poll(10).meta).toEqual({n: 0})
    expect(rb.canIssue()).toBe(true)
  })

  it('stops at the first unfinished read, as the GPU finishes them in order', () => {
    const gl = fakeGl()
    const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
    rb.issue({n: 1}, 1)
    rb.issue({n: 2}, 2)
    // A status that says the second is done before the first (not a GPU's)
    // still waits for the first.
    gl.getSyncParameter = (sync) => (sync.id === 2 ? SIGNALED : UNSIGNALED)
    expect(rb.poll(3)).toBeNull()
    expect(rb.inFlight).toBe(2)
  })

  it('frees its buffers and fences', () => {
    const gl = fakeGl()
    const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
    rb.issue({}, 0)
    rb.dispose()
    expect(gl.live.size).toBe(0)
    expect(rb.inFlight).toBe(0)
  })
})


/**
 * The metered exposure over a run of frames, as ThreeUi drives it
 * (_updateExposure, _meter, _meterApply): a uniform grey scene whose
 * luminance at the keyed exposure is `scene(frame)`, rendered into the
 * buffer pre-exposed (times the gain the frame renders with), metered every
 * METER_EVERY_FRAMES frames, the reading `delay` frames late (0: the
 * synchronous readPixels), divided by the gain its own frame rendered with.
 *
 * @param {function(number): number} scene
 * @param {object} options
 * @param {number} options.frames
 * @param {number} options.delay Frames from a read's issue to its fence's signal
 * @param {number} [options.dt] Seconds a frame
 * @param {boolean} [options.readGainLate] Divide by the gain at the reading's
 *   arrival rather than its frame's: what keeping the frame's gain with the read avoids
 * @returns {Array<number>} The gain each frame renders with
 */
function simulate(scene, {frames, delay, dt = 1 / 60, readGainLate = false}) {
  const gl = fakeGl()
  const rb = new AsyncReadback(gl, {width: SIZE, height: SIZE})
  let meterGain = 1
  let goal = 1
  let exposure = 1
  const rendered = []
  const apply = (pixels, renderedOverKeyed) => {
    const g = meteredGain(meanLogLuminance(pixels, PIXELS), renderedOverKeyed, false)
    if (Number.isFinite(g)) {
      goal = g
    }
  }
  for (let frame = 0; frame < frames; frame++) {
    // _updateExposure: the keyed exposure is 1 here.
    meterGain = adaptMeterGain(meterGain, goal, frame === 0 ? Infinity : dt)
    exposure = easeExposure(exposure, meterGain, frame === 0 ? Infinity : dt, EXPOSURE_TAU_SECONDS)
    const renderedGain = exposure
    rendered.push(renderedGain)
    // The frame, pre-exposed.
    gl.framebuffer.fill(scene(frame) * renderedGain)
    // _meter: poll, then meter on the cadence.
    // The GPU has got through the reads issued `delay` or more frames ago.
    for (const slot of rb._inFlight) {
      if (slot.frame <= frame - delay) {
        gl.signalledUpTo = Math.max(gl.signalledUpTo, slot.sync.id)
      }
    }
    const reading = delay > 0 ? rb.poll(frame) : null
    if (reading) {
      apply(reading.pixels, readGainLate ? renderedGain : reading.meta.renderedOverKeyed)
    }
    if (frame % METER_EVERY_FRAMES === 0) {
      if (delay === 0) {
        apply(gl.framebuffer, renderedGain)
      } else {
        rb.issue({renderedOverKeyed: renderedGain}, frame)
      }
    }
  }
  return rendered
}


describe('the metered exposure, read late', () => {
  // A step up (a sunlit scene to a star field: the eye adapting, 1.5 s)
  // and back down to a twilight (0.3 s), as HDR.md's numbers have them.
  const lit = 0.3
  const dark = 1e-12
  const twilight = 1e-3
  const stepAt = 40
  const backAt = 1000
  const frames = 1300
  const scene = (f) => (f < stepAt ? lit : (f < backAt ? dark : twilight))

  for (const delay of [1, 2, 3]) {
    it(`is the synchronous curve ${delay} frame${delay > 1 ? 's' : ''} later, settling on the same gain`, () => {
      const sync = simulate(scene, {frames, delay: 0})
      const late = simulate(scene, {frames, delay})
      // Settled at 1 in the sunlit scene, the dark-adapted gain before the
      // step back, and the twilight's after it, alike.
      expect(late[stepAt - 1]).toBe(1)
      expect(sync[backAt - 1] / METER_GAIN_MAX).toBeCloseTo(1, 1)
      expect(late[backAt - 1] / sync[backAt - 1]).toBeCloseTo(1, 2)
      expect(sync[frames - 1] * twilight / METER_KEY).toBeCloseTo(1, 2)
      expect(late[frames - 1] / sync[frames - 1]).toBeCloseTo(1, 3)
      // The same curve, shifted: the synchronous one `delay` frames before,
      // to the float32 buffer's rounding, wherever it moves.
      for (let f = delay; f < frames; f++) {
        expect(Math.abs(Math.log(late[f] / sync[f - delay]))).toBeLessThan(1e-6)
      }
    })
  }

  it('never overshoots or rings: monotone toward each goal, once its reading is in', () => {
    const delay = 3
    const late = simulate(scene, {frames, delay})
    // The step's reading is in `delay` frames after the metering that sees it.
    const seen = (f) => (Math.ceil(f / METER_EVERY_FRAMES) * METER_EVERY_FRAMES) + delay + 1
    for (let f = stepAt + 1; f < seen(backAt); f++) {
      expect(late[f]).toBeGreaterThanOrEqual(late[f - 1] * (1 - 1e-12))
    }
    for (let f = seen(backAt) + 1; f < frames; f++) {
      expect(late[f]).toBeLessThanOrEqual(late[f - 1] * (1 + 1e-12))
    }
  })

  it('needs the gain its own frame rendered with: the gain at arrival misreads a moving exposure', () => {
    // Coming down from the dark-adapted gain the exposure falls several
    // percent a frame; three frames late, a reading divided by the gain at
    // its arrival reads the scene brighter than it was, and asks for less.
    const right = simulate(scene, {frames, delay: 3})
    const wrong = simulate(scene, {frames, delay: 3, readGainLate: true})
    const at = backAt + 30
    expect(Math.log(right[at] / wrong[at])).toBeGreaterThan(0.01)
  })
})
