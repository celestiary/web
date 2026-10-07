import {describe, expect, it} from 'bun:test'
import {makeBarrier} from './barrier.js'


/** A context that records its calls, with framebuffer and renderbuffer bindings. */
function fakeGl() {
  const calls = []
  const gl = {
    calls,
    FRAMEBUFFER: 1, RENDERBUFFER: 2, FRAMEBUFFER_BINDING: 3, RENDERBUFFER_BINDING: 4, RGBA8: 5, COLOR_ATTACHMENT0: 6,
    COLOR_BUFFER_BIT: 7, RGBA: 8, UNSIGNED_BYTE: 9,
    framebuffer: 'page',
    getParameter: (p) => (p === gl.FRAMEBUFFER_BINDING ? gl.framebuffer : 'rb'),
    bindFramebuffer: (t, f) => {
      gl.framebuffer = f
      calls.push(['bindFramebuffer', f])
    },
  }
  for (const name of ['finish', 'createRenderbuffer', 'bindRenderbuffer', 'renderbufferStorage', 'createFramebuffer',
    'framebufferRenderbuffer', 'clear', 'readPixels']) {
    gl[name] = (...args) => {
      calls.push([name])
      return name.startsWith('create') ? {name} : undefined
    }
  }
  return gl
}


describe('makeBarrier', () => {
  it('finish: calls gl.finish()', () => {
    const gl = fakeGl()
    makeBarrier(gl)()
    makeBarrier(gl, 'finish')()
    expect(gl.calls).toEqual([['finish'], ['finish']])
  })

  it('read: clears and reads back a 1x1 target of its own, and leaves the binding as it found it', () => {
    const gl = fakeGl()
    const wait = makeBarrier(gl, 'read')
    wait()
    expect(gl.calls.map((c) => c[0])).toContain('readPixels')
    expect(gl.calls.map((c) => c[0])).not.toContain('finish')
    expect(gl.framebuffer).toBe('page')
    const created = gl.calls.filter((c) => c[0] === 'createFramebuffer').length
    wait()
    expect(gl.calls.filter((c) => c[0] === 'createFramebuffer')).toHaveLength(created)
    expect(gl.calls.filter((c) => c[0] === 'readPixels')).toHaveLength(2)
    expect(gl.framebuffer).toBe('page')
  })
})
