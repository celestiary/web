import React, {useEffect, useRef} from 'react'


/**
 * The menu's choices for a state: each with its label, key, whether it's
 * the current one and whether it can be chosen now.
 *
 * @param {{mode: ?string, auto: boolean, body: ?string}} state Scene.cameraMode's
 * @param {Function} label Names a body (bodyLabel)
 * @param {object} [opts]
 * @param {boolean} [opts.canLeave] Whether there is a frame above to leave
 *   the body for (not at the Sun)
 * @returns {Array<{id: string, text: string, key: ?string, checked: boolean, disabled: boolean, hint: ?string}>}
 */
export function cameraModeChoices(state, label, {canLeave = true} = {}) {
  const b = label(state.body)
  const standing = state.mode === 'standing'
  const riding = state.mode === 'orbit' || state.mode === 'turning'
  return [
    {id: 'fixed', text: 'Fixed in space', key: 'f', checked: state.mode === 'fixed',
      disabled: standing || !canLeave, hint: standing ? 'Go somewhere to leave the ground' :
        (canLeave ? `${b} moves on without you` : `Nothing above ${b} to leave`)},
    {id: 'orbit', text: `Riding ${b}'s orbit`, key: 'f', checked: state.mode === 'orbit' && !state.auto,
      disabled: standing, hint: `${b} turns under you`},
    {id: 'turning', text: `Turning with ${b}`, key: 'y', checked: state.mode === 'turning' && !state.auto,
      disabled: standing, hint: 'The ground stays put under you'},
    {id: 'auto', text: 'By height (auto)', key: null, checked: riding && state.auto,
      disabled: standing, hint: 'Turning below 30 km, riding the orbit above'},
    {id: 'standing', text: `Standing on ${b}`, key: null, checked: standing,
      disabled: true, hint: standing ? null : 'Double-click the ground'},
  ]
}


/**
 * The camera control's menu (CameraModeControl.jsx): the ways the camera
 * can move, each with its key, the current one checked, and facing the
 * target.  Plain buttons on the design tokens (index.css .camera-mode-menu),
 * not MUI's Menu, whose popover and items were 13 KB of the first load.
 * Closes on a choice, Escape or a press outside it.
 *
 * @param {object} props
 * @param {object} props.anchor The label's ref
 * @param {{mode: ?string, auto: boolean, body: ?string}} props.state Scene.cameraMode's
 * @param {Function} props.label Names a body
 * @param {boolean} props.canLeave Whether there is a frame above to leave
 * @param {boolean} props.tracking Whether the camera faces the target (`t`)
 * @param {Function} props.onChoose Called with a choice's id, or 'track'
 * @param {Function} props.onClose
 * @returns {object} A React element
 */
export default function CameraModeMenu({anchor, state, label, canLeave, tracking, onChoose, onClose}) {
  const menu = useRef(null)
  useEffect(() => {
    menu.current?.querySelector('button:not(:disabled)')?.focus()
    const onDown = (e) => {
      if (!menu.current?.contains(e.target) && !anchor?.current?.contains(e.target)) {
        onClose()
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose()
        anchor?.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  const item = (id, text, hint, key, checked, disabled) => (
    <button key={id} type='button' role='menuitemradio' aria-checked={checked} disabled={disabled}
      className='camera-mode-item' data-testid={`camera-mode-${id}`} onClick={() => onChoose(id)}>
      <span className='camera-mode-check' aria-hidden='true'>{checked ? '✓' : ''}</span>
      <span className='camera-mode-text'>
        <span>{text}</span>
        {hint && <span className='camera-mode-hint'>{hint}</span>}
      </span>
      {key && <span className='camera-mode-key'>{key}</span>}
    </button>
  )
  return (
    <div ref={menu} role='menu' aria-label='How the camera moves' className='camera-mode-menu'
      data-testid='camera-mode-menu'>
      {cameraModeChoices(state, label, {canLeave}).map((c) => item(c.id, c.text, c.hint, c.key, c.checked, c.disabled))}
      <hr className='camera-mode-rule'/>
      {item('track', 'Facing the target', 'Keep it centred', 't', tracking, false)}
    </div>
  )
}
