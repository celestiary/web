import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {formatEv} from '../scene/evCompensation'


/** How long the readout stays after a change, ms. */
const SHOW_MS = 2000


/**
 * The exposure compensation, shown briefly when it changes ('-', '=', 'e'
 * or a link's `ev=`): "EV +1.3", fading after a couple of seconds.
 *
 * @property {object} celestiary The app (onExposureCompensation)
 * @returns {ReactElement}
 */
export default function ExposureReadout({celestiary}) {
  const [ev, setEv] = useState(0)
  const [shown, setShown] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const stop = celestiary.onExposureCompensation((next) => {
      setEv(next)
      setShown(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(false), SHOW_MS)
    })
    return () => {
      stop()
      clearTimeout(timer.current)
    }
  }, [celestiary])

  return (
    <div
      id='ev-id'
      className={shown ? 'shown' : ''}
      role='status'
      aria-live='polite'
      data-testid='exposure-readout'
    >
      {formatEv(ev)}
    </div>
  )
}
