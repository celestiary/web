import React, {ReactElement, useEffect, useState} from 'react'
import {useLocation} from 'wouter'
import Button from '@mui/material/Button'
import Dialog from './Dialog'


/** @returns {ReactElement} */
export default function Settings({keys, href = '~/'}) {
  const [isOpen, setIsOpen] = useState(false)
  const [location] = useLocation()
  useEffect(() => setIsOpen(location === '/settings'), [location])
  return (
    <Dialog title='Key Shortcuts' isOpen={isOpen} setIsOpen={setIsOpen} onCloseHref={href}>
      <ul style={{listStyleType: 'none'}}>
        {Object.keys(keys.keymap).map((key, ndx) => (
          <li key={ndx}>
            <Button onClick={keys.keymap[key]}>
              {key === ' ' ? 'Spc' : key}
            </Button>
            {keys.msgs[key]}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
