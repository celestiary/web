import React from 'react'
import {useLocation} from 'wouter'
import MuiDialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'


/** @returns {React.ReactElement} */
export default function Dialog({title, isOpen, setIsOpen, onCloseHref, children}) {
  const [, navigate] = useLocation()
  return (
    <MuiDialog
      open={isOpen}
      onClose={() => navigate('/')}
      id='help'
      size='sm'
      fullWidth={true}
    >
      <DialogTitle sx={{fontSize: '1.5rem'}}> {/* Equiv to h2 in theme */}
        {title}
        <IconButton onClick={() => navigate('/')} sx={{float: 'right'}}><CloseIcon/></IconButton>
      </DialogTitle>
      <DialogContent>
        {children}
      </DialogContent>
    </MuiDialog>
  )
}
