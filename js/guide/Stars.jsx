import React, {ReactElement, useEffect} from 'react'
import ThreeUi from '../ThreeUI'
import StarsFromApp from '../Stars'
import {getSunProps} from '../StarsCatalog'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Stars() {
  useEffect(() => setup(), [])
  return (
    <>
      <div id={uiId}></div>
      <h1>Stars</h1>
      <>The star catalog uses Celestia&apos;s star.dat database</>
    </>
  )
}


/** */
function setup() {
  const ui = new ThreeUi(uiId)
  ui.camera.position.z = 1e1
  ui.useStore = {setState: () => {}}

  const props = {
    radius: {
      scalar: getSunProps(0.1).radiusMeters,
    },
  }
  const stars = new StarsFromApp(props, ui, true)

  ui.scene.add(stars)
}
