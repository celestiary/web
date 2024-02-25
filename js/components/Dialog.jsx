import React from 'react'
import {Link as RouterLink, useLocation} from 'wouter'
import MuiDialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'


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
        <RouterLink href={onCloseHref} onClick={() => setIsOpen(false)} style={{float: 'right'}}>X</RouterLink>
      </DialogTitle>
      <DialogContent>
        {children}
      </DialogContent>
    </MuiDialog>
  )
}
