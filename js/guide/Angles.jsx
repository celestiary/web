import React, {useEffect} from 'react'
import {AxesHelper, LineBasicMaterial} from 'three'
import * as Shared from '../shared.js'
import {angle} from '../shapes.js'
import ThreeUi from '../ThreeUI.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Angles() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>Angles</h1>
      <div id={uiId}></div>
    </>)
}


/** Initialize threejs helpers and load angles */
function setup() {
  const ui = new ThreeUi(uiId)
  ui.camera.position.set(0, 1, 4)

  const material = new LineBasicMaterial({
    color: 0x00ff00,
  })

  const axes1 = new AxesHelper
  axes1.position.x = -1.1
  axes1.add(angle(41 * Shared.toRad, null, material, true))
  ui.scene.add(axes1)

  const axes2 = new AxesHelper
  axes2.position.x = 1.1
  const angle2 = angle(270 * Shared.toRad, null, material, true)
  angle2.rotation.x = Math.PI / 2
  axes2.add(angle2)
  ui.scene.add(axes2)
}
