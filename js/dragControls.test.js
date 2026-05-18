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

  it('defaults to \'pan\' mode (free look) with no accessors and no target', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startPos = camera.position.clone()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130})

    // Pan changes orientation but not position.
    expect(camera.position.equals(startPos)).toBe(true)
  })

  it('\'auto\' mode resolves to \'orbit\' when camera is far from target', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(1e8, 0, 0) // far from a 6.4e6 m radius body
    const startPos = camera.position.clone()
    const target = {props: {radius: {scalar: 6.4e6}}}
    attachPointerDrag(el, camera, {
      getDragMode: () => 'auto',
      getTarget: () => target,
    })

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100})

    // Orbit moves position; pan would not.
    expect(camera.position.equals(startPos)).toBe(false)
  })

  it('\'auto\' mode resolves to \'pan\' when camera is close to target', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(6.4e6, 0, 0) // at surface of 6.4e6 m radius body
    const startPos = camera.position.clone()
    const target = {props: {radius: {scalar: 6.4e6}}}
    attachPointerDrag(el, camera, {
      getDragMode: () => 'auto',
      getTarget: () => target,
    })

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100})

    expect(camera.position.equals(startPos)).toBe(true) // pan: position unchanged
  })

  it('\'pan\' mode rotates camera quaternion only (position unchanged)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 100)
    const startPos = camera.position.clone()
    const startQuat = camera.quaternion.clone()
    attachPointerDrag(el, camera, {getDragMode: () => 'pan'})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130})

    expect(camera.position.equals(startPos)).toBe(true)
    expect(camera.quaternion.equals(startQuat)).toBe(false)
  })

  it('\'orbit\' mode rotates camera position around platform origin (rigid body)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    attachPointerDrag(el, camera, {getDragMode: () => 'orbit'})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100})

    expect(camera.position.equals(startPos)).toBe(false)
    // Distance from origin is preserved in rigid-body orbit.
    expect(Math.abs(camera.position.length() - startPos.length())).toBeLessThan(1e-6)
  })

  it('latches mode at pointerdown — getDragMode flipping mid-drag does not switch behavior', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    let mode = 'orbit'
    attachPointerDrag(el, camera, {getDragMode: () => mode})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    // Flip the source-of-truth mid-drag.  The handler should keep using
    // the mode it latched at pointerdown.
    mode = 'pan'
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100})

    // Position changed → still in orbit mode despite the flip.
    expect(camera.position.equals(startPos)).toBe(false)
  })

  it('invokes onChange exactly once per pointermove', () => {
    const el = makeFakeElement()
    const onChange = mock()
    attachPointerDrag(el, new PerspectiveCamera(), {onChange})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130})
    el.fire('pointermove', {pointerId: 1, clientX: 160, clientY: 140})

    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('ignores pointermove with no matching pointerdown (e.g. stray events)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startQuat = camera.quaternion.clone()
    const onChange = mock()
    attachPointerDrag(el, camera, {onChange})

    el.fire('pointermove', {pointerId: 99, clientX: 10, clientY: 10})

    expect(onChange).not.toHaveBeenCalled()
    expect(camera.quaternion.equals(startQuat)).toBe(true)
  })

  it('ignores a second simultaneous pointer so pinch-zoom flows to TrackballControls', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    const afterFirst = camera.quaternion.clone()

    // Second finger lands while first is still down — should be ignored.
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 200, clientY: 200})
    el.fire('pointermove', {pointerId: 2, clientX: 250, clientY: 250})

    expect(camera.quaternion.equals(afterFirst)).toBe(true)
  })

  it('releases the active pointer on pointerup so the next press can claim it', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1})
    // After release, a different pointerId can take over.
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 50, clientY: 50})
    const beforeMove = camera.quaternion.clone()
    el.fire('pointermove', {pointerId: 2, clientX: 100, clientY: 80})

    expect(camera.quaternion.equals(beforeMove)).toBe(false)
  })

  it('alt held at pointerdown inverts the resolved mode (pan → orbit)', () => {
    // Regression: alt-key one-shot override must keep working as a
    // desktop power-user escape hatch even with the visible toggle.
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    let preventCalled = false
    attachPointerDrag(el, camera, {getDragMode: () => 'pan'})

    el.fire('pointerdown', {
      button: 0, pointerId: 1, clientX: 100, clientY: 100,
      altKey: true, preventDefault: () => {
        preventCalled = true
      },
    })
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100, altKey: true})

    // Stored mode is 'pan' (which would leave position alone) but alt
    // inverts to 'orbit' → position changes.
    expect(camera.position.equals(startPos)).toBe(false)
    expect(preventCalled).toBe(true)
  })

  it('alt held at pointerdown inverts the resolved mode (orbit → pan)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    attachPointerDrag(el, camera, {getDragMode: () => 'orbit'})

    el.fire('pointerdown', {
      button: 0, pointerId: 1, clientX: 100, clientY: 100,
      altKey: true, preventDefault: () => {},
    })
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130, altKey: true})

    // Stored mode 'orbit' inverted to 'pan' → position unchanged.
    expect(camera.position.equals(startPos)).toBe(true)
  })

  it('alt-invert applies once at pointerdown — releasing alt mid-drag does not flip back', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    const startPos = camera.position.clone()
    attachPointerDrag(el, camera, {getDragMode: () => 'pan'})

    el.fire('pointerdown', {
      button: 0, pointerId: 1, clientX: 100, clientY: 100,
      altKey: true, preventDefault: () => {},
    })
    // Release alt mid-gesture.  Mode latched at pointerdown was 'orbit'
    // (pan inverted), and stays orbit for the gesture.
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 100, altKey: false})

    expect(camera.position.equals(startPos)).toBe(false)
  })

  it('ignores non-primary mouse buttons (right-click, middle-click)', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const startQuat = camera.quaternion.clone()
    attachPointerDrag(el, camera)

    el.fire('pointerdown', {button: 2, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointermove', {pointerId: 1, clientX: 150, clientY: 130})

    expect(camera.quaternion.equals(startQuat)).toBe(true)
  })

  it('fires onClick on a quick pointerup with no movement', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const onClick = mock()
    attachPointerDrag(el, camera, {onClick})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1, clientX: 101, clientY: 100})

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when the gesture moved beyond CLICK_PX_THRESHOLD', () => {
    const el = makeFakeElement()
    const camera = new PerspectiveCamera()
    const onClick = mock()
    attachPointerDrag(el, camera, {onClick})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    // 20 px is well above the 5 px click threshold — counts as a drag.
    el.fire('pointerup', {pointerId: 1, clientX: 120, clientY: 100})

    expect(onClick).not.toHaveBeenCalled()
  })

  it('fires onDblClick on the second of two quick clicks at the same spot', () => {
    const el = makeFakeElement()
    const onClick = mock()
    const onDblClick = mock()
    attachPointerDrag(el, new PerspectiveCamera(), {onClick, onDblClick})

    // Two clicks at the same point in rapid succession.
    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 2, clientX: 100, clientY: 100})

    // Browser-style: onClick fires twice, onDblClick fires once on the second.
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(onDblClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onDblClick when the second click is far from the first', () => {
    const el = makeFakeElement()
    const onDblClick = mock()
    attachPointerDrag(el, new PerspectiveCamera(), {onDblClick})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1, clientX: 100, clientY: 100})
    // 200 px away — well beyond the 8 px dblclick proximity gate.
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 300, clientY: 100})
    el.fire('pointerup', {pointerId: 2, clientX: 300, clientY: 100})

    expect(onDblClick).not.toHaveBeenCalled()
  })

  it('does not double-fire onDblClick on a triple-click (only first pair counts)', () => {
    // Regression guard: after a dblclick fires, the next single tap must
    // start a fresh pair — otherwise a triple-tap would fire dblclick
    // twice (tap1+tap2 and tap2+tap3 both qualifying).
    const el = makeFakeElement()
    const onDblClick = mock()
    attachPointerDrag(el, new PerspectiveCamera(), {onDblClick})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 2, clientX: 100, clientY: 100})
    el.fire('pointerdown', {button: 0, pointerId: 3, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 3, clientX: 100, clientY: 100})

    expect(onDblClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onDblClick when only onClick is wired', () => {
    // The dblclick branch is gated on the consumer wiring onDblClick — when
    // it's not wired, click-pair bookkeeping still runs but is harmless.
    const el = makeFakeElement()
    const onClick = mock()
    attachPointerDrag(el, new PerspectiveCamera(), {onClick})

    el.fire('pointerdown', {button: 0, pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 1, clientX: 100, clientY: 100})
    el.fire('pointerdown', {button: 0, pointerId: 2, clientX: 100, clientY: 100})
    el.fire('pointerup', {pointerId: 2, clientX: 100, clientY: 100})

    expect(onClick).toHaveBeenCalledTimes(2)
    // No onDblClick to check — the test passes as long as nothing crashes.
  })
})
