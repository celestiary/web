import {describe, expect, it} from 'bun:test'
import {CountSink} from './counts.js'
import {installGlCounters, trianglesOf, uploadBytesOf} from './glCounters.js'


const TRIANGLES = 0x0004
const TRIANGLE_STRIP = 0x0005
const FRAMEBUFFER = 0x8D40
const READ_FRAMEBUFFER = 0x8CA8


/** A context that does nothing but remember it was called. */
function fakeGl() {
  const calls = []
  const gl = {drawingBufferWidth: 1000, drawingBufferHeight: 500, calls}
  for (const name of [
    'viewport', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements',
    'clear', 'clearBufferfv', 'bindFramebuffer', 'readPixels', 'getBufferSubData', 'finish', 'texImage2D',
    'texSubImage2D', 'blitFramebuffer', 'useProgram', 'createTexture', 'getError', 'getParameter',
    'getProgramParameter', 'getShaderParameter', 'getUniformLocation', 'getAttribLocation', 'checkFramebufferStatus',
    'getExtension', 'clientWaitSync', 'getQueryParameter',
  ]) {
    gl[name] = function recorded(...args) {
      calls.push(name)
      return name === 'createTexture' ? {} : undefined
    }
  }
  return gl
}


describe('trianglesOf', () => {
  it('counts by mode', () => {
    expect(trianglesOf(TRIANGLES, 9)).toBe(3)
    expect(trianglesOf(TRIANGLE_STRIP, 6)).toBe(4)
    expect(trianglesOf(0x0000, 6)).toBe(0)
    expect(trianglesOf(TRIANGLE_STRIP, 1)).toBe(0)
  })
})


describe('uploadBytesOf', () => {
  it('prefers the typed array, then an image, then the size', () => {
    expect(uploadBytesOf('texImage2D', [0, 0, 0, 8, 8, 0, 0, 0, new Uint8Array(100)])).toBe(100)
    expect(uploadBytesOf('texImage2D', [0, 0, 0, 0, 0, {width: 4, height: 4}])).toBe(64)
    expect(uploadBytesOf('texImage2D', [0, 0, 0, 8, 8, 0, 0, 0, null])).toBe(256)
    expect(uploadBytesOf('texSubImage2D', [0, 0, 0, 0, 8, 8, 0, 0, null])).toBe(0)
  })
})


describe('installGlCounters', () => {
  it('counts draws, their triangles, and attributes them to the pass running', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    sink.setPass('scene')
    gl.drawElements(TRIANGLES, 300, 0, 0)
    gl.drawArrays(TRIANGLES, 0, 30)
    sink.setPass('clouds')
    gl.drawElementsInstanced(TRIANGLES, 6, 0, 0, 10)
    const {total, perPass} = sink.take()
    expect(total.draws).toBe(3)
    expect(total.triangles).toBe(100 + 10 + 20)
    expect(perPass.scene.draws).toBe(2)
    expect(perPass.clouds.draws).toBe(1)
    expect(gl.calls.filter((c) => c.startsWith('draw'))).toHaveLength(3)
  })

  it('still makes the call, with its arguments and its result', () => {
    const gl = fakeGl()
    gl.createTexture = () => 'tex'
    gl.drawArrays = function drawArrays(...args) {
      gl.last = [this === gl, ...args]
    }
    installGlCounters(gl, new CountSink())
    gl.drawArrays(TRIANGLES, 1, 2)
    expect(gl.last).toEqual([true, TRIANGLES, 1, 2])
    expect(gl.createTexture()).toBe('tex')
  })

  it('takes a full-screen pass for a triangle or quad into most of the canvas', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    gl.viewport(0, 0, 1000, 500)
    gl.drawArrays(TRIANGLES, 0, 3)
    gl.drawElements(TRIANGLES, 6, 0, 0)
    gl.drawElements(TRIANGLES, 600, 0, 0)
    gl.viewport(0, 0, 32, 32)
    gl.drawArrays(TRIANGLES, 0, 3)
    expect(sink.take().total.fullscreen).toBe(2)
  })

  it('counts render-target switches only when the draw binding changes', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    const a = {}
    const b = {}
    gl.bindFramebuffer(FRAMEBUFFER, a)
    gl.bindFramebuffer(FRAMEBUFFER, a)
    gl.bindFramebuffer(FRAMEBUFFER, b)
    gl.bindFramebuffer(READ_FRAMEBUFFER, a)
    gl.bindFramebuffer(FRAMEBUFFER, null)
    expect(sink.take().total.fbSwitches).toBe(3)
  })

  it('counts readbacks that wait, and pixel-pack reads that do not', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    gl.readPixels(0, 0, 1, 1, 0, 0, new Uint8Array(4))
    gl.readPixels(0, 0, 1, 1, 0, 0, 0)
    gl.getBufferSubData(0, 0, new Uint8Array(4))
    gl.finish()
    const {total} = sink.take()
    expect(total.readbacks).toBe(3)
    expect(total.pboReads).toBe(1)
  })

  it('counts the calls that round-trip to the GPU process, by name', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    sink.setPass('cesium.replay')
    gl.getError()
    gl.getError()
    gl.getParameter(1)
    gl.getProgramParameter({}, 1)
    gl.getShaderParameter({}, 1)
    gl.getUniformLocation({}, 'u')
    gl.getAttribLocation({}, 'a')
    gl.checkFramebufferStatus(1)
    gl.getExtension('x')
    gl.clientWaitSync({}, 0, 0)
    gl.getQueryParameter({}, 1)
    gl.readPixels(0, 0, 1, 1, 0, 0, new Uint8Array(4))
    // A read into a pixel-pack buffer does not wait.
    gl.readPixels(0, 0, 1, 1, 0, 0, 0)
    const taken = sink.take()
    expect(taken.total.syncCalls).toBe(12)
    expect(taken.sync.total.getError).toBe(2)
    expect(taken.sync.total.readPixels).toBe(1)
    expect(taken.sync.perPass['cesium.replay'].getExtension).toBe(1)
    expect(Object.keys(taken.sync.total)).toHaveLength(11)
  })

  it('counts nothing while the sink is muted (the overlay own calls)', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    sink.muted = true
    gl.getParameter(1)
    gl.finish()
    gl.drawArrays(TRIANGLES, 0, 3)
    sink.muted = false
    expect(sink.take().total).toEqual({...sink.take().total, draws: 0, syncCalls: 0, readbacks: 0})
    expect(gl.calls).toEqual(['getParameter', 'finish', 'drawArrays'])
  })

  it('counts uploads with their size, blits, clears and program changes', () => {
    const gl = fakeGl()
    const sink = new CountSink()
    installGlCounters(gl, sink)
    gl.texImage2D(0, 0, 0, 16, 16, 0, 0, 0, new Uint8Array(1024))
    gl.texSubImage2D(0, 0, 0, 0, 2, 2, 0, 0, new Uint8Array(16))
    gl.blitFramebuffer(0, 0, 1, 1, 0, 0, 1, 1, 0, 0)
    gl.clear(0)
    gl.clearBufferfv(0, 0, [0])
    gl.useProgram({})
    const {total} = sink.take()
    expect(total.uploads).toBe(2)
    expect(total.uploadBytes).toBe(1040)
    expect(total.blits).toBe(1)
    expect(total.clears).toBe(2)
    expect(total.programs).toBe(1)
  })

  it('takes the wrappers off again, leaving the context as it was', () => {
    const gl = fakeGl()
    const before = {...gl}
    const sink = new CountSink()
    const remove = installGlCounters(gl, sink)
    expect(gl.drawArrays).not.toBe(before.drawArrays)
    remove()
    for (const key of Object.keys(before)) {
      expect(gl[key]).toBe(before[key])
    }
    gl.drawArrays(TRIANGLES, 0, 3)
    expect(sink.take().total.draws).toBe(0)
  })

  it('removes wrappers it set over a prototype method by deleting them', () => {
    class Context {
      drawArrays() {
        return 'native'
      }
    }
    const gl = new Context
    const remove = installGlCounters(gl, new CountSink())
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(true)
    expect(gl.drawArrays()).toBe('native')
    remove()
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false)
    expect(gl.drawArrays()).toBe('native')
  })

  it('skips a method the context lacks', () => {
    const gl = {drawArrays() {}}
    expect(() => installGlCounters(gl, new CountSink())).not.toThrow()
  })
})
