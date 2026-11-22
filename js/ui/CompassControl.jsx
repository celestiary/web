import React, {useEffect, useRef, useState} from 'react'


/**
 * The compass (design/UI.md, the camera control, step 3; #361): near a body
 * its dial shows north on the ground under the camera and turns with the
 * heading.  A tap turns the view north-up; tapped again with north up, it
 * levels the view (Scene.compassTap).  Dragging round the dial turns the
 * heading.
 *
 * The heading is read each animation frame (Scene.cameraHeading) and the dial
 * turned by its style, with no React render; the compass shows and hides by
 * state, when there comes to be a body under the camera or not.
 */


/** How far a press moves before it's a drag of the ring and not a tap, px. */
export const DRAG_PX = 4


/**
 * @param {number} heading Radians east of north
 * @returns {string} What the compass says, for a screen reader and a tooltip:
 *   'Heading 123° (tap: north up)'
 */
export function compassLabel(heading) {
  const deg = Math.round(((heading * 180 / Math.PI) + 360) % 360)
  return deg === 0 || deg === 360 ? 'Heading north (tap: level)' : `Heading ${deg}° (tap: north up)`
}


/**
 * The angle of a point round a centre, screen-clockwise from up, radians.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @returns {number}
 */
export function angleAround(x, y, cx, cy) {
  return Math.atan2(x - cx, cy - y)
}


/**
 * @param {object} props
 * @param {object} props.celestiary
 * @returns {object} A React element, or null with no body under the camera
 */
export default function CompassControl({celestiary}) {
  const scene = celestiary.scene
  const [shown, setShown] = useState(false)
  const dial = useRef(null)
  const button = useRef(null)
  const drag = useRef(null)
  useEffect(() => {
    let frame = 0
    let last = null
    let wasShown = false
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const h = scene.cameraHeading?.() ?? null
      if (Boolean(h) !== wasShown) {
        wasShown = Boolean(h)
        setShown(wasShown)
      }
      if (!h || !dial.current) {
        return
      }
      const deg = -h.heading * 180 / Math.PI
      if (last === null || Math.abs(deg - last) > 0.2) {
        last = deg
        dial.current.style.transform = `rotate(${deg}deg)`
        button.current?.setAttribute('aria-label', compassLabel(h.heading))
        button.current?.setAttribute('title', compassLabel(h.heading))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [scene])
  if (!shown) {
    return null
  }
  const center = () => {
    const r = button.current.getBoundingClientRect()
    return [r.left + (r.width / 2), r.top + (r.height / 2)]
  }
  const onPointerDown = (e) => {
    const h = scene.cameraHeading?.()
    if (!h) {
      return
    }
    // A press and a move would otherwise start selecting the page's text,
    // which the camera menu then showed highlighted.
    e.preventDefault()
    const [cx, cy] = center()
    drag.current = {x: e.clientX, y: e.clientY, angle: angleAround(e.clientX, e.clientY, cx, cy), h, moved: false}
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) {
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) {
      return
    }
    d.moved = true
    const [cx, cy] = center()
    // The ring turns with the pointer, and the view the other way.
    const turn = angleAround(e.clientX, e.clientY, cx, cy) - d.angle
    scene.turnCamera(d.h.heading - turn, d.h.pitch)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      scene.compassTap()
    }
  }
  return (
    <button ref={button} type='button' className='compass' data-testid='compass' aria-label='Compass'
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          scene.compassTap()
        }
      }}>
      <svg ref={dial} className='compass-dial' viewBox='-20 -20 40 40' width='40' height='40' aria-hidden='true'>
        <circle r='18' className='compass-ring'/>
        <path d='M0 -14 L4.5 0 L-4.5 0 Z' className='compass-north'/>
        <path d='M0 14 L4.5 0 L-4.5 0 Z' className='compass-south'/>
      </svg>
    </button>
  )
}
