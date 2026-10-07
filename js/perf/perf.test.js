import {describe, expect, it} from 'bun:test'
import {Perf} from './perf.js'


const NOT_METAL = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)'
const METAL = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'
const EXT = {TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2}
const QUERY_RESULT = 4
const QUERY_RESULT_AVAILABLE = 3


/** A GL context: counts calls to getExtension, and has timer queries if asked. */
function fakeGl({timer = true, unmasked = NOT_METAL} = {}) {
  let queries = 0
  const gl = {
    drawingBufferWidth: 100,
    drawingBufferHeight: 50,
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    RENDERER: 'renderer',
    VENDOR: 'vendor',
    extensionCalls: 0,
    getError: () => 0,
    finishes: 0,
    finish() {
      gl.finishes++
    },
    getExtension(name) {
      gl.extensionCalls++
      if (name === 'WEBGL_debug_renderer_info') {
        return {UNMASKED_RENDERER_WEBGL: 'UNMASKED', UNMASKED_VENDOR_WEBGL: 'UNMASKED_VENDOR'}
      }
      return timer && name === 'EXT_disjoint_timer_query_webgl2' ? EXT : null
    },
    createQuery: () => ({id: queries++}),
    deleteQuery() {},
    beginQuery() {},
    endQuery() {},
    getParameter: (p) => (p === 'renderer' ? 'ANGLE (fake)' : p === 'vendor' ? 'Fake Inc' : p === 'UNMASKED' ? unmasked : false),
    getQueryParameter: (q, p) => {
      if (p !== QUERY_RESULT && p !== QUERY_RESULT_AVAILABLE) {
        throw new Error('INVALID_ENUM')
      }
      return p === QUERY_RESULT_AVAILABLE ? gl.ready !== false : 2e6
    },
    drawArrays() {},
    viewport() {},
    readPixels() {},
  }
  return gl
}


/** A ThreeUi with just what Perf reads. */
function fakeUi(gl = fakeGl(), milkyWay = null) {
  const renderer = {
    getContext: () => gl,
    info: {autoReset: true, render: {calls: 3, triangles: 100, points: 0, lines: 0}, reset() {}},
    getDrawingBufferSize: (v) => v.set(200, 100),
  }
  return {
    renderer, width: 100, height: 50, hdr: true, camera: {fov: 45}, layers: {active: [{name: 'earth'}]},
    scene: {getObjectByName: (n) => (n === 'MilkyWay' ? milkyWay : null)},
  }
}


/** Run one frame with the passes a real one has. */
function frame(perf, {clouds = true} = {}) {
  perf.frameBegin()
  perf.begin('update')
  perf.end('update')
  perf.begin('scene')
  perf.begin('galaxy')
  perf.end('galaxy')
  perf.end('scene')
  if (clouds && perf.begin('clouds')) {
    perf.end('clouds')
  }
  perf.begin('atmosphere')
  perf.end('atmosphere')
  perf.frameEnd()
}


describe('Perf off', () => {
  it('does nothing without ?perf=1: no GL touched, no wrapping, no timer, no DOM', () => {
    const ui = fakeUi()
    const gl = ui.renderer.getContext()
    const drawArrays = gl.drawArrays
    const perf = new Perf
    expect(perf.install(ui, {search: ''})).toBe(false)
    expect(perf.install(ui, {search: '?perf=0&off=clouds'})).toBe(false)
    expect(perf.enabled).toBe(false)
    expect(gl.extensionCalls).toBe(0)
    expect(gl.drawArrays).toBe(drawArrays)
    expect(ui.renderer.info.autoReset).toBe(true)
    expect(perf.overlay).toBeUndefined()
  })

  it('has hooks that run the pass and touch nothing', () => {
    const perf = new Perf
    expect(perf.begin('clouds')).toBe(true)
    expect(() => {
      perf.end('clouds')
      perf.frameBegin()
      perf.frameEnd()
      perf.attachCesium('earth', {frame() {}}, {core: {shadow: {}}})
    }).not.toThrow()
    const uniform = {value: 1}
    perf.gate('atmosphere', uniform)
    expect(uniform.value).toBe(1)
    expect(perf.runs('cesium')).toBe(true)
  })

  it('is off for the page too, where there is no location (bun)', () => {
    expect(new Perf().install(fakeUi())).toBe(false)
  })
})


describe('Perf on', () => {
  const on = (search = '?perf=1', ui = fakeUi()) => {
    const perf = new Perf
    expect(perf.install(ui, {search, overlay: false})).toBe(true)
    return {perf, ui}
  }

  it('wraps the GL calls and takes the renderer info off auto-reset', () => {
    const {perf, ui} = on()
    const gl = ui.renderer.getContext()
    expect(ui.renderer.info.autoReset).toBe(false)
    perf.frameBegin()
    gl.drawArrays(4, 0, 3)
    perf.frameEnd()
    expect(perf.stats.summary().total.counts.draws).toBe(1)
    perf.uninstall()
    expect(ui.renderer.info.autoReset).toBe(true)
  })

  it('times each pass on the CPU and the GPU, a frame at a time', () => {
    const {perf} = on()
    for (let i = 0; i < 5; i++) {
      frame(perf)
    }
    const sum = perf.stats.summary()
    const names = sum.passes.map((p) => p.name)
    expect(names).toEqual(['update', 'scene', 'galaxy', 'clouds', 'atmosphere', 'other'])
    expect(sum.passes.find((p) => p.name === 'scene').gpu.mean).toBeGreaterThan(0)
    expect(sum.total.gpu).not.toBe(null)
    expect(sum.total.cpu.n).toBe(5)
    expect(perf.note()).toBe('')
  })

  it('shows CPU times and says so where there is no GPU timer', () => {
    const {perf} = on('?perf=1', fakeUi(fakeGl({timer: false})))
    for (let i = 0; i < 3; i++) {
      frame(perf)
    }
    const sum = perf.stats.summary()
    expect(perf.gpu).toBe(null)
    expect(perf.note()).toContain('GPU timer unavailable')
    expect(sum.total.gpu).toBe(null)
    expect(sum.passes[0].gpu).toBe(null)
    expect(sum.passes[0].cpu).not.toBe(null)
    expect(JSON.parse(JSON.stringify(perf.snapshot())).timer.host).toBe(false)
  })

  it('skips a pass whose toggle is off, and leaves the rest running', () => {
    const {perf} = on('?perf=1&off=clouds,nightlights')
    expect(perf.begin('clouds')).toBe(false)
    expect(perf.begin('cesium.nightlights')).toBe(false)
    expect(perf.runs('clouds')).toBe(false)
    expect(perf.begin('scene')).toBe(true)
    expect(perf.begin('overlay')).toBe(true)
    // The skipped pass opened no section, so closing it does nothing to the others.
    perf.end('clouds')
    expect(() => frame(perf, {clouds: false})).not.toThrow()
    expect(perf.stats.summary().passes.map((p) => p.name)).not.toContain('clouds')
  })

  it('gates the atmosphere: the pass still runs, with its work switched off', () => {
    const {perf} = on('?perf=1&off=atmosphere')
    const uniform = {value: 1}
    expect(perf.begin('atmosphere')).toBe(true)
    perf.gate('atmosphere', uniform)
    expect(uniform.value).toBe(0)
    const other = {value: 1}
    perf.gate('clouds', other)
    expect(other.value).toBe(1)
  })

  it('hides the galaxy while its toggle is off, and restores what it was', () => {
    const mw = {visible: true}
    const {perf} = on('?perf=1&off=galaxy', fakeUi(fakeGl(), mw))
    frame(perf)
    expect(mw.visible).toBe(false)
    perf.setToggle('galaxy', true)
    frame(perf)
    expect(mw.visible).toBe(true)
    const hidden = {visible: false}
    const second = on('?perf=1&off=galaxy', fakeUi(fakeGl(), hidden))
    frame(second.perf)
    perf.uninstall()
    second.perf.setToggle('galaxy', true)
    frame(second.perf)
    expect(hidden.visible).toBe(false)
  })

  it('a switch changed at runtime applies from then on, and restarts the numbers', () => {
    const {perf} = on()
    frame(perf)
    expect(perf.stats.summary().passes.length).toBeGreaterThan(0)
    perf.setToggle('clouds', false)
    expect(perf.stats.summary().passes).toEqual([])
    expect(perf.begin('clouds')).toBe(false)
    perf.setToggle('clouds', true)
    expect(perf.begin('clouds')).toBe(true)
  })

  it('drops GPU frames still in flight when the numbers are reset, which are from before', () => {
    const gl = fakeGl()
    const {perf} = on('?perf=1', fakeUi(gl))
    gl.ready = false
    for (let i = 0; i < 3; i++) {
      frame(perf)
    }
    perf.setToggle('clouds', false)
    gl.ready = true
    frame(perf, {clouds: false})
    const names = perf.stats.summary().passes.map((p) => p.name)
    expect(names).toContain('scene')
    expect(names).not.toContain('clouds')
    expect(perf.stats.summary().total.gpu.n).toBe(1)
  })

  it('survives a frame whose end never came, and a pass whose end never came', () => {
    const {perf} = on()
    perf.frameBegin()
    perf.begin('scene')
    perf.begin('galaxy')
    perf.frameBegin()
    perf.begin('cesium')
    perf.begin('cesium.replay')
    perf.end('cesium')
    perf.frameEnd()
    expect(perf.sections.depth).toBe(0)
    expect(() => frame(perf)).not.toThrow()
  })

  it('does not open sections outside a frame', () => {
    const {perf} = on()
    expect(perf.begin('scene')).toBe(true)
    expect(perf.sections.depth).toBe(0)
    perf.end('scene')
  })

  it('times and counts the Cesium shadow context apart from the frame', () => {
    const {perf} = on()
    const shadow = fakeGl()
    let rendered = 0
    const link = {frame(render) {
      render()
    }}
    perf.attachCesium('earth', link, {core: {shadow}})
    perf.frameBegin()
    perf.begin('cesium.replay')
    link.frame(() => {
      rendered++
      shadow.drawArrays(4, 0, 3)
      shadow.drawArrays(4, 0, 3)
      shadow.readPixels(0, 0, 1, 1, 0, 0, new Uint8Array(4))
    })
    perf.end('cesium.replay')
    perf.frameEnd()
    perf.frameBegin()
    perf.frameEnd()
    expect(rendered).toBe(1)
    const ctx = perf.stats.summary().contexts['cesium.shadow.earth']
    expect(ctx.gpu.mean).toBeGreaterThan(0)
    expect(ctx.counts.draws).toBe(1)
    expect(ctx.counts.readbacks).toBe(0.5)
    // The host's own draws are not the shadow's.
    expect(perf.stats.summary().total.counts.draws).toBe(0)
    perf.uninstall()
    expect(perf.shadows.size).toBe(0)
  })

  it('makes a snapshot that is JSON, and names the view, the machine and the toggles', () => {
    const {perf} = on('?perf=1&off=meter')
    frame(perf)
    const snap = perf.snapshot()
    const back = JSON.parse(JSON.stringify(snap))
    expect(back.gpu.renderer).toBe('ANGLE (fake)')
    expect(back.viewport).toEqual({width: 100, height: 50, drawingBufferWidth: 200, drawingBufferHeight: 100})
    expect(back.toggles.meter).toBe(false)
    expect(back.toggles.clouds).toBe(true)
    expect(back.timer.host).toBe(true)
    expect(back.scene.cesiumActive).toEqual(['earth'])
    expect(back.timings.passes.length).toBeGreaterThan(0)
  })

  it('takes everything off on uninstall', () => {
    const ui = fakeUi()
    const gl = ui.renderer.getContext()
    const drawArrays = gl.drawArrays
    const {perf} = on('?perf=1&off=clouds', ui)
    expect(gl.drawArrays).not.toBe(drawArrays)
    perf.uninstall()
    expect(gl.drawArrays).toBe(drawArrays)
    expect(perf.enabled).toBe(false)
    expect(perf.begin('clouds')).toBe(true)
  })

  it('counts the page sync calls per pass, but not the overlay own (the timer polls, the snapshot)', () => {
    const gl = fakeGl({unmasked: NOT_METAL})
    const {perf} = on('?perf=1', fakeUi(gl))
    perf.frameBegin()
    perf.begin('cesium.replay')
    gl.getError()
    gl.getParameter('x')
    perf.end('cesium.replay')
    perf.frameEnd()
    perf.snapshot()
    perf.frameBegin()
    perf.frameEnd()
    const sum = perf.stats.summary()
    const replay = sum.passes.find((p) => p.name === 'cesium.replay')
    expect(replay.counts.syncCalls).toBe(1)
    expect(replay.syncByName).toEqual({getError: 0.5, getParameter: 0.5})
    expect(sum.total.counts.syncCalls).toBe(1)
  })

  it('reads GPU timers per encoder on ANGLE Metal: marks them, and gives no total', () => {
    const {perf} = on('?perf=1', fakeUi(fakeGl({unmasked: METAL})))
    for (let i = 0; i < 3; i++) {
      frame(perf)
    }
    expect(perf.timerGranularity()).toEqual({
      granularity: 'encoder', reason: 'ANGLE Metal (the renderer string says Metal)',
    })
    expect(perf.gpuMode()).toBe('encoder')
    expect(perf.note()).toContain('per encoder')
    const snap = JSON.parse(JSON.stringify(perf.snapshot()))
    expect(snap.timer.granularity).toBe('encoder')
    expect(snap.timer.mode).toBe('query')
    expect(snap.timings.total.gpu).toBe(null)
    expect(snap.timings.passes.find((p) => p.name === 'scene').gpu.mean).toBeGreaterThan(0)
  })

  it('finds per-encoder timers elsewhere by the passes adding up to more than the frame', () => {
    let t = 0
    const gl = fakeGl({unmasked: NOT_METAL})
    const perf = new Perf
    perf.install(fakeUi(gl), {search: '?perf=1', overlay: false, now: () => t})
    // 16 ms frames, whose passes read 2 ms each across 5 passes and 'other': 12 ms is under 1.5 x 16.
    for (let i = 0; i < 40; i++) {
      t += 16
      frame(perf)
    }
    expect(perf.timerGranularity().granularity).toBe('pass')
    expect(perf.gpuMode()).toBe('ok')
    // Now 5 ms frames: the same 12 ms of passes is more than 1.5 x the frame.
    perf.resetStats()
    perf.stats.reset()
    for (let i = 0; i < 40; i++) {
      t += 5
      frame(perf)
    }
    expect(perf.timerGranularity().granularity).toBe('encoder')
    expect(perf.timerGranularity().reason).toContain('add up')
    // Once seen, for good.
    expect(perf.gpuMode()).toBe('encoder')
  })

  it('trusts GPU timers where it has no reason not to', () => {
    const {perf} = on('?perf=1', fakeUi(fakeGl({unmasked: NOT_METAL})))
    frame(perf)
    expect(perf.timerGranularity().granularity).toBe(null)
    expect(perf.gpuMode()).toBe('ok')
    expect(perf.note()).toBe('')
  })

  it('?perf=sync waits for the GPU after every pass and times by the wall clock, with no timer queries', () => {
    let t = 0
    const gl = fakeGl({unmasked: NOT_METAL})
    const perf = new Perf
    perf.install(fakeUi(gl), {search: '?perf=sync', overlay: false, now: () => t})
    expect(perf.sync).toBe(true)
    expect(perf.gpu).toBe(null)
    expect(perf.gpuMode()).toBe('none')
    gl.drawArrays = ((orig) => function wrapped(...a) {
      t += 4
      return orig.apply(this, a)
    })(gl.drawArrays)
    perf.frameBegin()
    perf.begin('scene')
    gl.drawArrays(4, 0, 3)
    perf.end('scene')
    perf.begin('clouds')
    perf.end('clouds')
    perf.frameEnd()
    // The barrier ran at the end of each segment: other, scene, other, clouds, other.
    expect(gl.finishes).toBeGreaterThanOrEqual(4)
    const sum = perf.stats.summary()
    expect(sum.passes.find((p) => p.name === 'scene').cpu.mean).toBe(4)
    expect(sum.total.gpu).toBe(null)
    expect(perf.note()).toContain('SYNC TIMING')
    // Its own finish() calls are not the page's readbacks.
    expect(sum.total.counts.readbacks).toBe(0)
    const snap = perf.snapshot()
    expect(snap.timer.mode).toBe('sync')
    expect(snap.timer.barrier).toBe('finish')
    expect(snap.timings.clock).toBe('wall-synced')
  })

  it('sync timing can be switched on and off while running', () => {
    const {perf} = on('?perf=1', fakeUi(fakeGl({unmasked: NOT_METAL})))
    expect(perf.gpu).not.toBe(null)
    perf.setSync(true)
    expect(perf.gpu).toBe(null)
    frame(perf)
    expect(perf.stats.summary().total.gpu).toBe(null)
    perf.setSync(false)
    expect(perf.gpu).not.toBe(null)
    frame(perf)
    expect(perf.stats.summary().total.gpu).not.toBe(null)
  })

  it('waits on the Cesium shadow context too, and records the wait apart from the pass', () => {
    let t = 0
    const gl = fakeGl({unmasked: NOT_METAL})
    const perf = new Perf
    perf.install(fakeUi(gl), {search: '?perf=sync', overlay: false, now: () => t})
    const shadow = fakeGl()
    shadow.finish = function finish() {
      t += 7
      shadow.finishes++
    }
    const link = {frame(render) {
      t += 2
      render()
    }}
    perf.attachCesium('earth', link, {core: {shadow}})
    perf.frameBegin()
    perf.begin('cesium.replay')
    link.frame(() => shadow.getError?.())
    perf.end('cesium.replay')
    perf.frameEnd()
    const sum = perf.stats.summary()
    expect(shadow.finishes).toBe(1)
    expect(sum.contexts['cesium.shadow.earth'].gpu.mean).toBe(7)
    // The replay pass has its own 2 ms, not the shadow 7.
    expect(sum.passes.find((p) => p.name === 'cesium.replay').cpu.mean).toBe(2)
  })
})
