import {describe, expect, it, mock} from 'bun:test'
import {PerspectiveCamera} from 'three'
import {attachPointerDrag} from './dragControls'


/** Minimal stand-in for an HTMLElement: records handlers so tests can fire them. */
function makeFakeElement() {
  const handlers = {}
  return {
    style: {},
    handlers,
    addEventListener: (name, fn) => {
      handlers[name] = fn
    },
    setPointerCapture: () => {},
    fire: (name, ev) => handlers[name]?.(ev),
  }
}


describe('attachPointerDrag', () => {
  it('binds pointer events — not mouse events — so touch input drives camera drag', () => {
    // Regression guard: mobile-broken drag came from binding mousedown /
    // mousemove, which don't fire from touch.  Pointer events cover mouse,
    // pen, and touch with one API.
    const el = makeFakeElement()
    attachPointerDrag(el, new PerspectiveCamera())
    expect(el.handlers.pointerdown).toBeDefined()
    expect(el.handlers.pointermove).toBeDefined()
    expect(el.handlers.pointerup).toBeDefined()
    expect(el.handlers.pointercancel).toBeDefined()
    expect(el.handlers.mousedown).toBeUndefined()
    expect(el.handlers.mousemove).toBeUndefined()
  })

  it('sets touch-action: none so the browser does not eat single-finger drags', () => {
    const el = makeFakeElement()
    attachPointerDrag(el, new PerspectiveCamera())
    expect(el.style.touchAction).toBe('none')
  })

  it('rotates the camera quaternion in response to a pointerdown + pointermove sequence', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startQuat = camera.quaternion.clone()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: false})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130, altKey: false})

    expect(camera.quaternion.equals(startQuat)).toBe(false)
  })

  it('invokes onChange exactly once per pointermove', () => {
    const el = makeFakeElement()
    const onChange = mock()
    attachPointerDrag(el, new PerspectiveCamera(), onChange)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: false})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130, altKey: false})
    el.fire('pointermove', {pointerId: 1, clientX: 160, clientY: 140, altKey: false})

    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('ignores pointermove with no matching pointerdown (e.g. stray events)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startQuat = camera.quaternion.clone()
    const onChange = mock()
    attachPointerDrag(el, camera, onChange)

    el.fire('pointermove', {pointerId: 99, clientX: 10, clientY: 10, altKey: false})

    expect(onChange).not.toHaveBeenCalled()
    expect(camera.quaternion.equals(startQuat)).toBe(true)
  })

  it('ignores a second simultaneous pointer so pinch-zoom flows to TrackballControls', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: false})
    const afterFirst = camera.quaternion.clone()

    // Second finger lands while first is still down — should be ignored.
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 200, clientY: 200, altKey: false})
    el.fire('pointermove', {pointerId: 2, clientX: 250, clientY: 250, altKey: false})

    expect(camera.quaternion.equals(afterFirst)).toBe(true)
  })

  it('releases the active pointer on pointerup so the next press can claim it', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: false})
    el.fire('pointerup', {pointerId: 1})
    // After release, a different pointerId can take over.
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 50, clientY: 50, altKey: false})
    const beforeMove = camera.quaternion.clone()
    el.fire('pointermove', {pointerId: 2, clientX: 100, clientY: 80, altKey: false})

    expect(camera.quaternion.equals(beforeMove)).toBe(false)
  })

  it('alt+drag orbits camera position (rigid-body rotation around platform origin)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    attachPointerDrag(el, camera)

    el.fire('pointerdown',
        {button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: true, preventDefault: () => {}})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100, altKey: true})

    expect(camera.position.equals(startPos)).toBe(false)
  })

  it('ignores non-primary mouse buttons (right-click, middle-click)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startQuat = camera.quaternion.clone()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 2, pointerId: 1, clientX: 100, clientY: 100, altKey: false})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130, altKey: false})

    expect(camera.quaternion.equals(startQuat)).toBe(true)
  })
})
