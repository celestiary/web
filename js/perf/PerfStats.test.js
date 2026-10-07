import {describe, expect, it} from 'bun:test'
import {CountSink, zeroCounts} from './counts.js'
import {tableRows, countsLine, fmtCount, fmtMs, fmtBig} from './format.js'
import PerfStats from './PerfStats.js'
import {orderedPasses} from './passes.js'
import {buildSnapshot, snapshotJson} from './snapshot.js'


/** @returns {object} A frame's counts as CountSink gives them */
function counts(perPass) {
  const sink = new CountSink()
  for (const [pass, c] of Object.entries(perPass)) {
    sink.setPass(pass)
    for (const [key, n] of Object.entries(c)) {
      sink.bump(key, n)
    }
  }
  return sink.take()
}


describe('sync calls', () => {
  it('count by name, in total and by pass, and not while muted', () => {
    const sink = new CountSink()
    sink.setPass('cesium.replay')
    sink.bumpSync('getError')
    sink.bumpSync('getError')
    sink.bumpSync('getParameter')
    sink.setPass('meter')
    sink.bumpSync('readPixels')
    sink.muted = true
    sink.bumpSync('getError')
    sink.bump('draws')
    sink.muted = false
    const taken = sink.take()
    expect(taken.total.syncCalls).toBe(4)
    expect(taken.total.draws).toBe(0)
    expect(taken.perPass['cesium.replay'].syncCalls).toBe(3)
    expect(taken.sync.total).toEqual({getError: 2, getParameter: 1, readPixels: 1})
    expect(taken.sync.perPass.meter).toEqual({readPixels: 1})
    expect(sink.take().sync.total).toEqual({})
  })

  it('are summarised per pass and in total, with the breakdown', () => {
    const s = new PerfStats(10)
    for (let i = 0; i < 4; i++) {
      const sink = new CountSink()
      sink.setPass('cesium.replay')
      sink.bumpSync('getError')
      sink.bumpSync('getError')
      if (i === 0) {
        sink.setPass('meter')
        sink.bumpSync('readPixels')
      }
      s.addCounts(sink.take(), {})
    }
    const sum = s.summary()
    const byName = Object.fromEntries(sum.passes.map((p) => [p.name, p]))
    expect(byName['cesium.replay'].counts.syncCalls).toBe(2)
    expect(byName['cesium.replay'].syncByName).toEqual({getError: 2})
    expect(byName.meter.syncByName).toEqual({readPixels: 0.25})
    expect(sum.total.syncByName).toEqual({getError: 2, readPixels: 0.25})
    expect(sum.total.counts.syncCalls).toBe(2.25)
    expect(countsLine(sum)).toContain('sync calls 2.3 (getError 2, readPixels 0.3)')
  })
})


describe('CountSink', () => {
  it('totals what the passes counted, and starts afresh on take', () => {
    const sink = new CountSink()
    sink.setPass('scene')
    sink.bump('draws', 10)
    sink.setPass('atmosphere')
    sink.bump('draws')
    sink.bump('fullscreen')
    const first = sink.take()
    expect(first.total.draws).toBe(11)
    expect(first.perPass.scene.draws).toBe(10)
    expect(first.perPass.atmosphere.fullscreen).toBe(1)
    expect(sink.take().total).toEqual(zeroCounts())
  })
})


describe('PerfStats', () => {
  it('summarises a pass as means and p95 over the frames, zero where it did not run', () => {
    const s = new PerfStats(100)
    for (let i = 0; i < 100; i++) {
      s.addGpu({ms: {'scene': 4, 'cesium.nightlights': i < 50 ? 2 : 0}, total: 6})
      s.addCpu({scene: 1, other: 0.5}, 1.5)
      s.addCounts(counts({scene: {draws: 100}, atmosphere: {draws: 1, fullscreen: 1}}), {calls: 101})
      s.addInterval(16.7)
    }
    const sum = s.summary()
    const byName = Object.fromEntries(sum.passes.map((p) => [p.name, p]))
    expect(byName.scene.gpu.mean).toBe(4)
    expect(byName['cesium.nightlights'].gpu.mean).toBe(1)
    expect(byName['cesium.nightlights'].gpu.runShare).toBe(0.5)
    expect(byName['cesium.nightlights'].gpu.p95).toBe(2)
    expect(byName.scene.cpu.mean).toBe(1)
    expect(byName.scene.counts.draws).toBe(100)
    expect(byName.atmosphere.counts.fullscreen).toBe(1)
    expect(sum.total.gpu.mean).toBe(6)
    expect(sum.total.cpu.mean).toBe(1.5)
    expect(sum.total.counts.draws).toBe(101)
    expect(sum.three.calls).toBe(101)
    expect(sum.frame.fps).toBeCloseTo(59.9, 1)
  })

  it('lists the passes in their order, and any the registry does not know after them', () => {
    expect(orderedPasses(['overlay', 'zodiacal', 'scene', 'atmosphere', 'nightsky'])).toEqual(
        ['scene', 'atmosphere', 'overlay', 'zodiacal', 'nightsky'])
    const s = new PerfStats()
    s.addGpu({ms: {zodiacal: 1, scene: 2}, total: 3})
    expect(s.summary().passes.map((p) => p.name)).toEqual(['scene', 'zodiacal'])
  })

  it('has no GPU total until a GPU frame has come in', () => {
    const s = new PerfStats()
    s.addCpu({scene: 1}, 1)
    expect(s.summary().total.gpu).toBe(null)
    expect(s.summary().passes[0].gpu).toBe(null)
  })

  it('keeps other contexts apart from the total', () => {
    const s = new PerfStats()
    s.addGpu({ms: {scene: 2}, total: 2})
    s.addContextGpu('cesium.shadow.earth', 5)
    s.addContextCounts('cesium.shadow.earth', {...zeroCounts(), draws: 40, readbacks: 1})
    const sum = s.summary()
    expect(sum.total.gpu.mean).toBe(2)
    expect(sum.contexts['cesium.shadow.earth'].gpu.mean).toBe(5)
    expect(sum.contexts['cesium.shadow.earth'].counts.draws).toBe(40)
    expect(sum.contexts['cesium.shadow.earth'].counts.readbacks).toBe(1)
  })

  it('forgets everything on reset', () => {
    const s = new PerfStats()
    s.addGpu({ms: {scene: 2}, total: 2})
    s.reset()
    expect(s.summary().passes).toEqual([])
  })
})


describe('format', () => {
  it('writes milliseconds and counts compactly', () => {
    expect(fmtMs(0)).toBe('0.00')
    expect(fmtMs(1.234)).toBe('1.23')
    expect(fmtMs(12.34)).toBe('12.3')
    expect(fmtMs(123.4)).toBe('123')
    expect(fmtMs(undefined)).toBe('-')
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(0.25)).toBe('0.3')
    expect(fmtCount(2)).toBe('2')
    expect(fmtCount(412.4)).toBe('412')
    expect(fmtBig(1234567)).toBe('1.2M')
    expect(fmtBig(34000)).toBe('34k')
    expect(fmtBig(12)).toBe('12')
  })

  it('makes a row per pass and a total, "n/a" for GPU where there is no timer', () => {
    const s = new PerfStats()
    s.addCpu({'scene': 1.5, 'cesium.replay': 2}, 3.5)
    s.addCounts(counts({scene: {draws: 7}}), {})
    const rows = tableRows(s.summary(), 'none')
    expect(rows.map((r) => r.name)).toEqual(['scene', 'cesium.replay', 'total'])
    expect(rows[1].depth).toBe(1)
    expect(rows[0].gpuMean).toBe('n/a')
    expect(rows[0].cpuMean).toBe('1.50')
    expect(rows[0].draws).toBe('7')
    expect(rows[2].cpuMean).toBe('3.50')
    expect(countsLine(s.summary())).toContain('full-screen 0')
    // GPU times per encoder are shown, with no total.
    s.addGpu({ms: {scene: 3}, total: 3})
    const encoder = tableRows(s.summary(), 'encoder')
    expect(encoder[0].gpuMean).toBe('3.00')
    expect(encoder[2].gpuMean).toBe('n/a')
    expect(tableRows(s.summary(), 'ok')[2].gpuMean).toBe('3.00')
  })
})


describe('buildSnapshot', () => {
  const s = new PerfStats()
  s.addGpu({ms: {scene: 3}, total: 3})
  s.addCpu({scene: 1}, 1)
  s.addCounts(counts({scene: {draws: 5}}), {})
  const snapshot = () => buildSnapshot({
    takenAt: new Date('2026-10-06T12:00:00Z'),
    link: 'https://celestiary.github.io/web/?perf=1#sun/earth@25,84,7.5km;cq=0,0,0,1',
    viewport: {width: 1280, height: 720, drawingBufferWidth: 2560, drawingBufferHeight: 1440},
    devicePixelRatio: 2,
    gpu: {renderer: 'ANGLE', vendor: 'Google', unmaskedRenderer: 'Apple M2', unmaskedVendor: 'Apple'},
    userAgent: 'Mozilla/5.0',
    timer: {host: true, shadow: true, disjoints: 0, dropped: 0},
    summary: s.summary(),
    off: new Set(['clouds', 'galaxy']),
    scene: {target: 'earth'},
  })

  it('is what the user pastes back: the view, the machine, the timings and the toggles', () => {
    const snap = snapshot()
    expect(snap.link).toContain('#sun/earth@25,84,7.5km')
    expect(snap.viewport.drawingBufferWidth).toBe(2560)
    expect(snap.devicePixelRatio).toBe(2)
    expect(snap.gpu.unmaskedRenderer).toBe('Apple M2')
    expect(snap.timer.host).toBe(true)
    expect(snap.toggles.clouds).toBe(false)
    expect(snap.toggles.galaxy).toBe(false)
    expect(snap.toggles.atmosphere).toBe(true)
    expect(Object.keys(snap.toggles).sort()).toEqual(
        ['atmosphere', 'cesium', 'clouds', 'galaxy', 'meter', 'nightlights', 'overlay'])
    expect(snap.timings.passes[0].name).toBe('scene')
    expect(snap.timings.passes[0].gpu.mean).toBe(3)
    expect(snap.timings.total.counts.draws).toBe(5)
    expect(snap.takenAt).toBe('2026-10-06T12:00:00.000Z')
    expect(snap.version).toBe(1)
  })

  it('is well-formed JSON that reads back the same', () => {
    const text = snapshotJson(snapshot())
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(snapshot())))
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('undefined')
  })

  it('says so where there are no GPU timers', () => {
    const snap = buildSnapshot({
      takenAt: new Date(0), link: '', viewport: {}, devicePixelRatio: 1, gpu: {}, userAgent: '',
      timer: {host: false, shadow: null, disjoints: 0, dropped: 0}, summary: new PerfStats().summary(), off: [],
    })
    expect(snap.timer.host).toBe(false)
    expect(snap.timings.total.gpu).toBe(null)
    expect(() => JSON.parse(snapshotJson(snap))).not.toThrow()
  })
})
