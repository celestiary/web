import React, {ReactElement, useEffect} from 'react'
import ThreeUi from '../ThreeUI'
import StarsFromApp from '../Stars'
import {getSunProps} from '../StarsCatalog'
import {METERS_PER_LIGHTYEAR, ASTRO_UNIT_METER} from '../shared'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Stars() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>Stars</h1>
      <div id={uiId}></div>
      <p>The star catalog uses Celestia&apos;s star.dat database</p>
    </>
  )
}


/** */
function setup() {
  const ui = new ThreeUi(uiId)
  // ui.camera.position.z = METERS_PER_LIGHTYEAR * 1e20
  ui.camera.position.z = ASTRO_UNIT_METER
  ui.useStore = {setState: () => {}, subscribe: () => {}}

  const props = {
    radius: {
      scalar: getSunProps(0.1).radiusMeters,
    },
  }
  const stars = new StarsFromApp(props, ui, true)

  ui.scene.add(stars)
}
