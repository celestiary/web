import {describe, expect, it} from 'bun:test'
import {leanShadow, stageLink} from './netglLean.js'


const ARRAY_BUFFER = 0x8892
const UNIFORM_BUFFER = 0x8A11
const STATIC_DRAW = 0x88E4
const TEXTURE_2D = 0x0DE1
const RGBA = 0x1908
const UNSIGNED_BYTE = 0x1401


/** @returns {object} A context whose prototype methods record their calls, as WebGL2's live on its prototype */
function fakeGl() {
  class Gl {}
  const calls = []
  const names = ['drawElements', 'drawArrays', 'clear', 'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D']
  names.push('bindBuffer', 'linkProgram')
  for (const name of names) {
    Gl.prototype[name] = function(...args) {
      calls.push([name, ...args])
    }
  }
  const gl = new Gl()
  gl.calls = calls
  return gl
}


describe('leanShadow', () => {
  it('drops draws and contents, keeps objects and state, and undoes', () => {
    const gl = fakeGl()
    const undo = leanShadow(gl)
    const data = new Float32Array(1000)
    gl.bindBuffer(ARRAY_BUFFER, 'b')
    gl.bufferData(ARRAY_BUFFER, data, STATIC_DRAW)
    gl.bufferData(UNIFORM_BUFFER, data, STATIC_DRAW)
    gl.bufferSubData(ARRAY_BUFFER, 0, data)
    gl.drawElements(4, 6, 0x1403, 0)
    gl.clear(0x4000)
    gl.texImage2D(TEXTURE_2D, 0, RGBA, 4, 4, 0, RGBA, UNSIGNED_BYTE, new Uint8Array(64))
    gl.texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, {width: 8, height: 2})
    gl.linkProgram('p')
    expect(gl.calls).toEqual([
      ['bindBuffer', ARRAY_BUFFER, 'b'],
      ['bufferData', ARRAY_BUFFER, 0, STATIC_DRAW],
      ['bufferData', UNIFORM_BUFFER, 4000, STATIC_DRAW],
      ['texImage2D', TEXTURE_2D, 0, RGBA, 4, 4, 0, RGBA, UNSIGNED_BYTE, null],
      ['texImage2D', TEXTURE_2D, 0, RGBA, 8, 2, 0, RGBA, UNSIGNED_BYTE, null],
      ['linkProgram', 'p'],
    ])
    undo()
    expect(Object.keys(gl)).toEqual(['calls'])
    gl.drawArrays(4, 0, 3)
    expect(gl.calls.at(-1)).toEqual(['drawArrays', 4, 0, 3])
  })

  it('is lean only while active, and reached through a recorder\'s Proxy', () => {
    const gl = fakeGl()
    let on = false
    leanShadow(gl, () => on)
    const recorder = new Proxy(gl, {
      get(target, prop) {
        const value = Reflect.get(target, prop)
        return typeof value === 'function' ? (...args) => value.apply(target, args) : value
      },
    })
    recorder.drawArrays(4, 0, 3)
    on = true
    recorder.drawArrays(4, 0, 6)
    expect(gl.calls).toEqual([['drawArrays', 4, 0, 3]])
  })
})


/**
 * A stand-in for portal-netgl's immediate link: calls posted while it's open
 * are replayed at once, while closed copied into its queue, replayed at the
 * next frame()'s start; a frame end closes it.
 *
 * @returns {object}
 */
function fakeLink() {
  let open = false
  const queue = []
  const replayed = []
  return {
    queue,
    replayed,
    transport: {
      post(msg) {
        if (typeof msg.name === 'string') {
          if (open) {
            replayed.push(msg)
          } else {
            queue.push(structuredClone(msg))
          }
        } else if (msg.type === 'netgl:frame-end') {
          open = false
          replayed.push('end')
        }
      },
      onMessage: () => () => {},
    },
    frame(render) {
      replayed.push(...queue.splice(0))
      open = true
      try {
        render()
      } finally {
        open = false
      }
    },
  }
}


/**
 * @param {string} name
 * @param {number} [bytes] A typed array argument this big, encoded as the recorder does
 * @returns {object} A NetGL call
 */
function call(name, bytes = 0) {
  const args = [1]
  if (bytes) {
    const a = new Uint8Array(bytes)
    args.push({__netgl_typedarray: 'Uint8Array', buffer: a.buffer, offset: 0, length: bytes})
  }
  return {name, args}
}


describe('stageLink', () => {
  /** @returns {object} {link, stage, post(msg)}, the guest's context's endFrame a frame end and a checkpoint call */
  function staged(budget) {
    const link = fakeLink()
    const stage = stageLink(link, budget)
    stage.attach({
      endFrame() {
        stage.transport.post({type: 'netgl:frame-end'})
        stage.transport.post(call('checkpoint'))
      },
    })
    return {link, stage, post: (msg) => stage.transport.post(msg)}
  }

  it('queues closed-link calls itself: uploads by reference, the rest copied', () => {
    const {link, stage, post} = staged()
    const upload = call('bufferData', 1 << 16)
    const uniform = call('uniform4fv', 16)
    post(upload)
    post(uniform)
    new Uint8Array(uniform.args[1].buffer)[0] = 7
    expect(link.queue).toEqual([])
    expect(stage.queued).toBe(2)
    stage.frame(() => {})
    expect(link.replayed[0]).toBe(upload)
    expect(link.replayed[1]).not.toBe(uniform)
    expect(new Uint8Array(link.replayed[1].args[1].buffer)[0]).toBe(0)
    expect(stage.stats.byReferenceBytes).toBe(1 << 16)
  })

  it('cuts its queue into chunks and replays one a step, each from a checkpoint', () => {
    const {link, stage, post} = staged({bytes: 1 << 17, programs: 2, calls: 1000})
    post(call('bufferData', 1 << 16))
    post(call('bufferData', 1 << 16)) // a chunk's bytes: cut
    post(call('linkProgram'))
    post(call('linkProgram')) // a chunk's programs: cut
    post(call('useProgram'))
    expect(stage.chunks).toBe(2)
    expect(stage.step()).toBe(true)
    expect(link.replayed.map((m) => m.name ?? m)).toEqual(['bufferData', 'bufferData', 'end'])
    expect(stage.step()).toBe(true)
    expect(link.replayed.slice(3).map((m) => m.name ?? m)).toEqual(['checkpoint', 'linkProgram', 'linkProgram', 'end'])
    expect(stage.step()).toBe(false)
    // The rest, and a frame: its calls straight through, its end's checkpoint queued for the next
    stage.frame(() => {
      post(call('drawElements'))
      post({type: 'netgl:frame-end'})
      post(call('checkpoint'))
    })
    expect(link.replayed.slice(7).map((m) => m.name ?? m)).toEqual(['checkpoint', 'useProgram', 'drawElements', 'end'])
    expect(stage.queued).toBe(1)
    expect(link.queue).toEqual([])
  })

  it('replays every chunk in a frame, dropping their ends', () => {
    const {link, stage, post} = staged({bytes: 1 << 16})
    post(call('bufferData', 1 << 16))
    post(call('bufferData', 1 << 16))
    expect(stage.chunks).toBe(2)
    stage.frame(() => post(call('deleteBuffer')))
    expect(link.replayed.map((m) => m.name ?? m)).toEqual(['bufferData', 'checkpoint', 'bufferData', 'checkpoint', 'deleteBuffer'])
    expect(stage.chunks).toBe(0)
  })
})
