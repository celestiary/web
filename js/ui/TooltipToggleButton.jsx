import React, {ReactElement, useState} from 'react'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'


/** @returns {ReactElement} */
export default function TooltipToggleButton({tip, icon, onClick, ...props}) {
  const [isSelected, setIsSelected] = useState(false)
  return (
    <Tooltip title={tip} describeChild>
      <ToggleButton
        onClick={onClick}
        selected={isSelected}
        value={''}
        onChange={(e, is) => setIsSelected(!isSelected)}
        {...props}
      >
        {icon}
      </ToggleButton>
    </Tooltip>
  )
}
