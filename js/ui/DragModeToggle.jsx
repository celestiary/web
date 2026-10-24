import React, {ReactElement} from 'react'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import OpenWithIcon from '@mui/icons-material/OpenWith'
import ControlCameraIcon from '@mui/icons-material/ControlCamera'
import useStore from '../store/useStore'


/**
 * Two-button selector for camera drag mode: one of the two is always on.
 * The mode changes only here, by `m`, and on navigating (Scene.goTo sets
 * orbit, Scene.land pan), never with altitude.
 *
 * The selected button gets a vivid blue halo so the mode reads at a glance.
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
  const dragMode = useStore((state) => state.dragMode)
  const setDragMode = useStore((state) => state.setDragMode)
  // ToggleButtonGroup with `exclusive` emits null when the user clicks
  // the selected button: it stays selected.
  const onChange = (_e, next) => next && setDragMode(next)
  return (
    <ToggleButtonGroup
      value={dragMode}
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
