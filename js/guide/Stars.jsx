import React, {ReactElement, useEffect} from 'react'
import createTree from '@pablo-mayrgundter/yaot2'
import ThreeUi from '../ThreeUI'
import StarsFromApp from '../Stars'
import {getSunProps} from '../StarsCatalog'
import {marker as createMarker} from '../shapes'
import {queryPoints} from '../Picker'
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

  const mockStore = {setState: () => {}}
  const stars = new StarsFromApp(mockStore, {
    radius: {
      scalar: getSunProps(0.1).radiusMeters,
    },
  },
  null,
  () => {
    const tree = createTree()
    tree.init(stars.geom.coords)
    const marker = createMarker()
    ui.scene.add(marker)
    const markCb = (e) => {
      queryPoints(ui, e, tree, stars, (pick) => {
        marker.position.copy(pick)
      })
    }
    document.body.addEventListener('dblclick', markCb)
    // document.body.addEventListener('mousemove', markCb)
  },
  true)
  ui.scene.add(stars)
}
