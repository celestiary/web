import React from 'react'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'


/** @returns {React.ReactElement} */
export default function TolltipIconButton({tip, onClick, icon}) {
  return (
    <Tooltip title={tip} describeChild>
      <IconButton onClick={onClick}>{icon}</IconButton>
    </Tooltip>
  )
}
