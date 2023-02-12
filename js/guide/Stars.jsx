import React from 'react'
import createTree from '@pablo-mayrgundter/yaot2'
import ThreeUi from '../ThreeUI'
import StarsFromApp from '../Stars'
import {getSunProps} from '../StarsCatalog'
import {marker as createMarker} from '../shapes'
import {queryPoints} from '../Picker'


/** @returns {React.Component} */
export default function Stars() {
  React.useEffect(() => {
    setup()
  }, [])
  return (
    <>
      <div id="ui"></div>
      <h1>Stars</h1>
    </>)
}


/** */
function setup() {
  const ui = new ThreeUi('ui')
  ui.camera.position.z = 1e1

  const stars = new StarsFromApp({
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
