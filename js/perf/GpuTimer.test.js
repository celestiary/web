import {describe, expect, it} from 'bun:test'
import GpuTimer, {MAX_PENDING_FRAMES} from './GpuTimer.js'
import Sections from './sections.js'


// What the extension object has: just these two (the result enums are the context's).
const EXT = {
  TIME_ELAPSED_EXT: 0x88BF,
  GPU_DISJOINT_EXT: 0x8FBB,
}
const QUERY_RESULT = 0x8866
const QUERY_RESULT_AVAILABLE = 0x8867


/**
 * A GL context that has timer queries and nothing else: each query's result
 * (ns) is what the test sets, and is "available" once the test says.
 */
function fakeGl({extension = EXT} = {}) {
  const gl = {
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    created: 0,
    active: null,
    maxActive: 0,
    began: 0,
    disjoint: false,
    results: new Map(),
    availableAfter: new Map(),
    deleted: 0,
    getExtension: (name) => (name === 'EXT_disjoint_timer_query_webgl2' ? extension : null),
    createQuery: () => ({id: gl.created++}),
    deleteQuery: () => gl.deleted++,
    beginQuery: (target, q) => {
      if (gl.active) {
        throw new Error('INVALID_OPERATION: a TIME_ELAPSED query is already active')
      }
      gl.active = q
      gl.began++
      // Each segment lasts what the test says, by the order it began.
      gl.results.set(q, gl.nextNs?.() ?? 1e6)
    },
    endQuery: () => {
      if (!gl.active) {
        throw new Error('INVALID_OPERATION: no query is active')
      }
      gl.active = null
    },
    getParameter: (p) => {
      if (p === EXT.GPU_DISJOINT_EXT) {
        const d = gl.disjoint
        gl.disjoint = false
        return d
      }
      return null
    },
    getQueryParameter: (q, p) => {
      if (p === QUERY_RESULT_AVAILABLE) {
        return gl.ready !== false
      }
      if (p !== QUERY_RESULT) {
        throw new Error('INVALID_ENUM')
      }
      return gl.results.get(q)
    },
  }
  return gl
}


describe('GpuTimer.create', () => {
  it('is null where the extension is missing', () => {
    expect(GpuTimer.create(fakeGl({extension: null}))).toBe(null)
  })

  it('is null for a context without getExtension, or one that throws', () => {
    expect(GpuTimer.create({})).toBe(null)
    expect(GpuTimer.create({getExtension: () => {
      throw new Error('blocked')
    }})).toBe(null)
  })

  it('is a timer where it is present', () => {
    expect(GpuTimer.create(fakeGl())).toBeInstanceOf(GpuTimer)
  })
})


describe('GpuTimer', () => {
  it('reads a frame a few frames later, never waiting', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    gl.ready = false
    t.startFrame(1)
    t.start('scene')
    t.stop()
    t.endFrame()
    expect(t.poll()).toEqual([])
    gl.ready = true
    const done = t.poll()
    expect(done).toHaveLength(1)
    expect(done[0].id).toBe(1)
    expect(done[0].ms.scene).toBe(1)
  })

  it('sums the segments of a name and gives the frame total, in ms', () => {
    const gl = fakeGl()
    const ns = [2e6, 3e6, 5e6]
    gl.nextNs = () => ns.shift()
    const t = GpuTimer.create(gl)
    t.startFrame(1)
    t.start('scene')
    t.start('galaxy')
    t.start('scene')
    t.endFrame()
    const [f] = t.poll()
    expect(f.ms).toEqual({scene: 7, galaxy: 3})
    expect(f.total).toBe(10)
  })

  it('works under Sections without ever nesting TIME_ELAPSED queries', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    const s = new Sections({start: (n) => t.start(n), stop: () => t.stop()})
    t.startFrame(1)
    s.open('other')
    s.open('scene')
    s.open('galaxy')
    s.close('galaxy')
    s.close('scene')
    s.open('cesium')
    s.open('cesium.replay')
    s.close('cesium.replay')
    s.close('cesium')
    s.closeAll()
    t.endFrame()
    const [f] = t.poll()
    expect(Object.keys(f.ms).sort()).toEqual(['cesium', 'cesium.replay', 'galaxy', 'other', 'scene'])
    expect(gl.active).toBe(null)
  })

  it('reads frames in order and stops at the first not yet in', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    for (let id = 1; id <= 3; id++) {
      t.startFrame(id)
      t.start('a')
      t.endFrame()
    }
    gl.ready = true
    expect(t.poll().map((f) => f.id)).toEqual([1, 2, 3])
    expect(t.poll()).toEqual([])
  })

  it('discards every frame in flight on GPU_DISJOINT_EXT, and the one being built', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    t.startFrame(1)
    t.start('a')
    t.endFrame()
    t.startFrame(2)
    t.start('a')
    gl.disjoint = true
    expect(t.poll()).toEqual([])
    t.endFrame()
    expect(t.disjoints).toBe(1)
    expect(t.dropped).toBe(1)
    expect(t.pending).toHaveLength(0)
    // The flag cleared by reading it: the next frame is read.
    t.startFrame(3)
    t.start('a')
    t.endFrame()
    expect(t.poll().map((f) => f.id)).toEqual([3])
  })

  it('reuses its queries', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    for (let id = 1; id <= 20; id++) {
      t.startFrame(id)
      t.start('a')
      t.start('b')
      t.endFrame()
      t.poll()
    }
    expect(gl.created).toBeLessThanOrEqual(4)
  })

  it('drops the oldest frames when the GPU is far behind', () => {
    const gl = fakeGl()
    gl.ready = false
    const t = GpuTimer.create(gl)
    for (let id = 1; id <= MAX_PENDING_FRAMES + 5; id++) {
      t.startFrame(id)
      t.start('a')
      t.endFrame()
    }
    expect(t.pending).toHaveLength(MAX_PENDING_FRAMES)
    expect(t.dropped).toBe(5)
    gl.ready = true
    expect(t.poll()[0].id).toBe(6)
  })

  it('does nothing outside a frame, and ends a segment left running at the frame end', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    t.start('a')
    expect(gl.began).toBe(0)
    t.startFrame(1)
    t.start('b')
    t.endFrame()
    expect(gl.active).toBe(null)
    expect(t.poll()[0].ms).toEqual({b: 1})
  })

  it('a frame with no sections is read as zero', () => {
    const t = GpuTimer.create(fakeGl())
    t.startFrame(1)
    t.endFrame()
    expect(t.poll()).toEqual([{id: 1, ms: {}, total: 0}])
  })

  it('deletes its queries on dispose', () => {
    const gl = fakeGl()
    const t = GpuTimer.create(gl)
    t.startFrame(1)
    t.start('a')
    t.endFrame()
    t.dispose()
    expect(gl.deleted).toBe(1)
    expect(gl.active).toBe(null)
  })
})
