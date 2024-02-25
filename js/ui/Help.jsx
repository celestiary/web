import React, {useEffect, useState} from 'react'
import {useLocation} from 'wouter'
import Dialog from './Dialog'


/** @returns {React.ReactElement} */
export default function Help({keys, href = '~/'}) {
  const [isOpen, setIsOpen] = useState(false)
  const [location] = useLocation()
  useEffect(() => setIsOpen(location === '/help'), [location])
  return (
    <Dialog title='Keyboard Shortcuts' isOpen={isOpen} setIsOpen={setIsOpen} onCloseHref={href}>
      <ul style={{listStyleType: 'none'}}>
        {Object.keys(keys.keymap).map((key, ndx) => (
          <li key={ndx}>
            <span
              style={{
                fontFamily: 'Courier',
                width: '3em',
                display: 'inline-block',
              }}
            >
              {key === ' ' ? 'Spc' : key}
            </span>
            {keys.msgs[key]}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
