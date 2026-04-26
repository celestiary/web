import React, {ReactElement} from 'react'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import OpenWithIcon from '@mui/icons-material/OpenWith'
import ControlCameraIcon from '@mui/icons-material/ControlCamera'
import useStore from '../store/useStore'


/**
 * Two-button selector for camera drag mode.  Highlights whichever mode
 * is *effectively* active right now — when `dragMode === 'auto'` the
 * highlight follows the auto-resolution, so the user can see the mode
 * shift as they zoom or navigate.  Clicking an unselected button locks
 * to that mode; clicking the already-selected button deselects → back
 * to `'auto'`.  Scene.goTo resets to `'auto'` on navigation.
 *
 * The selected button gets a vivid blue halo so a context-driven
 * mode shift catches the eye.
 *
 * @returns {ReactElement}
 */
const HALO_SX = {
  '&.Mui-selected': {
    color: '#90caf9',
    backgroundColor: 'rgba(33, 150, 243, 0.18)',
    boxShadow: '0 0 14px 2px rgba(33, 150, 243, 0.85), inset 0 0 6px rgba(33, 150, 243, 0.35)',
    '&:hover': {
      backgroundColor: 'rgba(33, 150, 243, 0.28)',
    },
  },
  transition: 'box-shadow 200ms ease, background-color 200ms ease',
}


/** @returns {ReactElement} */
export default function DragModeToggle() {
  const effective = useStore((state) => state.effectiveDragMode)
  const setDragMode = useStore((state) => state.setDragMode)
  // ToggleButtonGroup with `exclusive` emits null when the user clicks
  // the currently-selected button — interpret that as "back to auto".
  const onChange = (_e, next) => setDragMode(next ?? 'auto')
  return (
    <ToggleButtonGroup
      value={effective}
      exclusive
      onChange={onChange}
      size='small'
      aria-label='Camera drag mode'
    >
      <Tooltip title='Drag Pan: pitch/yaw camera in place'>
        <ToggleButton value='pan' aria-label='Pan' sx={HALO_SX}>
          <OpenWithIcon/>
        </ToggleButton>
      </Tooltip>
      <Tooltip title='Move: rotate camera around target'>
        <ToggleButton value='orbit' aria-label='Orbit' sx={HALO_SX}>
          <ControlCameraIcon/>
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  )
}
