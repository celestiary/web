import React, {ReactElement, useEffect} from 'react'
import ThreeUi from '../ThreeUI'
import StarsFromApp from '../Stars'
import {getSunProps} from '../StarsCatalog'
import {ASTRO_UNIT_METER} from '../shared'
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
  ui.configLargeScene()
  ui.camera.position.z = ASTRO_UNIT_METER
  ui.useStore = {setState: () => {}, subscribe: () => {}}

  const props = {
    radius: {
      scalar: getSunProps().radius,
    },
  }
  const stars = new StarsFromApp(props, ui, true)

  ui.scene.add(stars)
}
