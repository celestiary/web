import React, {ReactElement} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import TooltipToggleButton from './TooltipToggleButton'
import {assertDefined} from '../assert'


/** @returns {ReactElement} */
export default function NavToggleButton({hashTag, tip, icon}) {
  assertDefined(hashTag, tip, icon)
  const [location] = useHashLocation()
  return (
    <TooltipToggleButton
      onClick={() => console.log('on onClick, location:', location)}
      isSelected={location === hashTag}
      setIsSelected={(is) => console.log('on setIsSelected, location', location)}
      value={''}
      onChange={(e, is) => console.log('on onChange, location', location)}
      icon={icon}
    />
  )
}
