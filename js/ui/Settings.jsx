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
        {numbersLastIterator(keys.keymap).map((key, ndx) => (
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


/**
 * Create a new iteration array for given object, with numbers last.
 *
 * @param {object} obj
 * @returns {Array<object>} newly ordered array with numbrers last
 */
function numbersLastIterator(obj) {
  // Separate integer-like keys and non-integer-like keys
  const integerLikeKeys = []
  const nonIntegerLikeKeys = []

  Object.keys(obj).forEach((key) => {
    if (/^\d+$/.test(key)) {
      integerLikeKeys.push(key)
    } else {
      nonIntegerLikeKeys.push(key)
    }
  })

  // Return the concatenated array: first non-integer keys, then integer keys
  return [...nonIntegerLikeKeys, ...integerLikeKeys]
}
