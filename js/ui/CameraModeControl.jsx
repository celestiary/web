import React, {useEffect, useRef, useState} from 'react'
import CameraModeMenu from './CameraModeMenu.jsx'


/**
 * The camera control's label and menu (design/UI.md, the camera control;
 * #361): how the camera moves, in words, and a menu to change it.  The
 * state is Scene.cameraMode's ({mode, auto, body}), which Celestiary
 * announces when it changes (onCameraMode).
 */


/** How long the label stays lit after the height switches it (auto), ms. */
export const FLASH_MS = 1500


/**
 * @param {string} name A body's name ('earth')
 * @param {object} [scene] Celestiary's scene, for the body's own label
 * @returns {string} How the body is named ('Earth', '2026 ED138')
 */
export function bodyLabel(name, scene) {
  const label = scene?.objects?.[name]?.props?.label
  if (label) {
    return label
  }
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : ''
}


/**
 * @param {{mode: ?string, auto: boolean, body: ?string}} state Scene.cameraMode's
 * @param {Function} label Names a body (bodyLabel)
 * @returns {?string} 'Turning with Earth (auto)', 'Riding Earth's orbit',
 *   'Fixed in space', 'Standing on Earth'; null when there's no body to ride
 */
export function cameraModeLabel(state, label) {
  const b = label(state.body)
  const auto = state.auto ? ' (auto)' : ''
  switch (state.mode) {
    case 'fixed': return 'Fixed in space'
    case 'orbit': return `Riding ${b}'s orbit${auto}`
    case 'turning': return `Turning with ${b}${auto}`
    case 'standing': return `Standing on ${b}`
    default: return null
  }
}


/**
 * The label and its menu, stateless (CameraModeControl wires it).
 *
 * @param {object} props
 * @param {{mode: ?string, auto: boolean, body: ?string}} props.state
 * @param {Function} props.label Names a body
 * @param {boolean} props.canLeave
 * @param {boolean} props.tracking Whether the camera faces the target (`t`)
 * @param {boolean} props.flash Whether the label is lit (the height switched it)
 * @param {Function} props.onChoose Called with a choice's id, or 'track'
 * @returns {object} A React element, or null with no body to ride
 */
export function CameraModeView({state, label, canLeave, tracking, flash, onChoose}) {
  const anchor = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const text = cameraModeLabel(state, label)
  if (!text) {
    return null
  }
  const choose = (id) => {
    setMenuOpen(false)
    onChoose(id)
  }
  return (
    <span className='camera-mode-wrap'>
      <button
        ref={anchor}
        type='button'
        onClick={() => setMenuOpen(true)}
        aria-haspopup='menu'
        aria-label={`Camera: ${text}`}
        data-testid='camera-mode'
        className={flash ? 'camera-mode camera-mode-flash' : 'camera-mode'}
      >
        {text} <span aria-hidden='true' className='camera-mode-caret'>▾</span>
      </button>
      {menuOpen &&
        <CameraModeMenu anchor={anchor} state={state} label={label} canLeave={canLeave}
          tracking={tracking} onChoose={choose} onClose={() => setMenuOpen(false)}/>}
    </span>
  )
}


/**
 * The camera control's label and menu, wired to Celestiary: it hears the
 * camera's state (onCameraMode) and tracking (onNavMode), lights the label
 * when the height switches it, and sets what's chosen
 * (Scene.setCameraMode, Scene.track).
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @returns {object} A React element
 */
export default function CameraModeControl({celestiary}) {
  const scene = celestiary.scene
  const [state, setState] = useState(() => scene.cameraMode?.() ?? {mode: null, auto: false, body: null})
  const [tracking, setTracking] = useState(() => Boolean(celestiary.shared?.targets?.track))
  const [flash, setFlash] = useState(false)
  const last = useRef(state)
  useEffect(() => {
    let timer = null
    const offMode = celestiary.onCameraMode((next) => {
      const prev = last.current
      last.current = next
      setState(next)
      // The height switched it: say so (design/UI.md, automatic, and said so).
      if (next.auto && prev.auto && prev.body === next.body && prev.mode !== next.mode) {
        setFlash(true)
        clearTimeout(timer)
        timer = setTimeout(() => setFlash(false), FLASH_MS)
      }
    })
    const offNav = celestiary.onNavMode((mode, on) => {
      if (mode === 'track') {
        setTracking(on)
      }
    })
    return () => {
      offMode()
      offNav()
      clearTimeout(timer)
    }
  }, [celestiary])
  const label = (name) => bodyLabel(name, scene)
  const parent = scene.objects?.[state.body]?.props?.parent
  const onChoose = (id) => {
    if (id === 'track') {
      scene.track()
    } else {
      scene.setCameraMode(id)
    }
  }
  return (
    <CameraModeView state={state} label={label} canLeave={Boolean(parent)} tracking={tracking} flash={flash}
      onChoose={onChoose}/>
  )
}
