import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {formatNavMode} from '../navMode'
import {formatEv} from '../scene/evCompensation'
import {formatStarMag} from '../scene/starMagnitude'


/** How long the readout stays after a change, ms. */
const SHOW_MS = 2000


/**
 * The exposure compensation, shown briefly when it changes ('-', '=', 'e'
 * or a link's `ev=`): "EV +1.3", fading after a couple of seconds.  The
 * stars' setting ('[', ']' or a link's `sm=`) is shown the same way, as
 * "Stars +1.0 mag": whichever changed last.  So are 't' and 'f', as
 * "Tracking on" and "Following off" (a link's `s=T` or `s=F` too).
 *
 * @property {object} celestiary The app (onExposureCompensation, onNavMode)
 * @returns {ReactElement}
 */
export default function ExposureReadout({celestiary}) {
  const [text, setText] = useState(formatEv(0))
  const [shown, setShown] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const show = (message) => {
      setText(message)
      setShown(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(false), SHOW_MS)
    }
    const stopEv = celestiary.onExposureCompensation((next) => show(formatEv(next)))
    const stopStars = celestiary.onStarMagnitude((next) => show(formatStarMag(next)))
    const stopMode = celestiary.onNavMode((mode, on, note) => show(formatNavMode(mode, on, note)))
    return () => {
      stopEv()
      stopStars()
      stopMode()
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
      {text}
    </div>
  )
}
