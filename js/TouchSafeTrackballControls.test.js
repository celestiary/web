import {PerspectiveCamera} from 'three'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'
import TouchSafeTrackballControls from './TouchSafeTrackballControls.js'


/** @returns {object} Just enough of an element for TrackballControls */
function fakeElement() {
  const listeners = {}
  const el = {
    style: {},
    captured: [],
    ownerDocument: {addEventListener() {}, removeEventListener() {}, documentElement: {clientLeft: 0, clientTop: 0}},
    addEventListener: (type, fn) => (listeners[type] ??= new Set()).add(fn),
    removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    setPointerCapture: (id) => el.captured.push(id),
    releasePointerCapture() {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 600}),
    /** Dispatch a touch pointer event to the listeners, in order. */
    fire(type, pointerId, pageX = 100, pageY = 100) {
      const event = {type, pointerId, pageX, pageY, pointerType: 'touch', button: 0, preventDefault() {}}
      for (const fn of [...(listeners[type] ?? [])]) {
        fn(event)
      }
    },
    count: (type) => listeners[type]?.size ?? 0,
  }
  return el
}


/**
 * A second finger whose pointerup went elsewhere (lifted over HTML), then a
 * touch reusing its ID, then another touch.
 *
 * @param {object} el
 */
function lostUpThenReusedId(el) {
  el.fire('pointerdown', 1)
  el.fire('pointerdown', 2)
  el.fire('pointerup', 1) // finger 2's up is lost
  el.fire('pointerdown', 2)
  el.fire('pointermove', 2, 120)
  el.fire('pointerup', 2)
  el.fire('pointerdown', 3)
  el.fire('pointermove', 3, 130)
  el.fire('pointerup', 3)
}


describe('TouchSafeTrackballControls', () => {
  const saved = {window: globalThis.window}
  beforeAll(() => {
    globalThis.window = {addEventListener() {}, removeEventListener() {}, pageXOffset: 0, pageYOffset: 0}
  })
  afterAll(() => {
    globalThis.window = saved.window
  })

  it('TrackballControls itself throws on a lost pointerup and a reused ID', () => {
    const el = fakeElement()
    new TrackballControls(new PerspectiveCamera(), el)
    expect(() => lostUpThenReusedId(el)).toThrow()
  })

  it('doesn\'t, and lists each pointer once', () => {
    const el = fakeElement()
    const controls = new TouchSafeTrackballControls(new PerspectiveCamera(), el)
    expect(() => lostUpThenReusedId(el)).not.toThrow()
    // Finger 2's lost up leaves it listed until its ID comes back and ends.
    expect(controls._pointers).toEqual([])
    expect(controls._pointerPositions).toEqual({})
  })

  it('captures every pointer, so each up comes back', () => {
    const el = fakeElement()
    new TouchSafeTrackballControls(new PerspectiveCamera(), el)
    el.fire('pointerdown', 1)
    el.fire('pointerdown', 2)
    expect(el.captured).toEqual([1, 1, 2])
  })

  it('pinches with a pointer that has no position, from where it went down', () => {
    const el = fakeElement()
    const controls = new TouchSafeTrackballControls(new PerspectiveCamera(), el)
    el.fire('pointerdown', 1, 100, 100)
    el.fire('pointerdown', 2, 200, 100)
    delete controls._pointerPositions[1]
    expect(controls._getSecondPointerPosition({pointerId: 2}).toArray()).toEqual([100, 100])
  })

  it('removes its capture listener on dispose', () => {
    const el = fakeElement()
    const controls = new TouchSafeTrackballControls(new PerspectiveCamera(), el)
    expect(el.count('pointerdown')).toBe(2)
    controls.dispose()
    expect(el.count('pointerdown')).toBe(0)
  })
})
