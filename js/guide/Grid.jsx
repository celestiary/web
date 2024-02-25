import React, {useEffect} from 'react'
import ThreeUi from '../ThreeUI.js'
import {grid} from '../shapes.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Grid() {
  useEffect(() => setup(), [])
  return (
    <>
      <div id={uiId}></div>
      <h1>A Grid</h1>
      Try zooming out and rotating.
    </>)
}


/** Initialize threejs helpers and load grid */
function setup() {
  const ui = new ThreeUi(uiId)
  ui.camera.position.z = 10

  const g = grid()
  g.material.color.setRGB(0, 0, 1)
  g.material.transparent = true
  // grid.material.opacity = 0.1;
  ui.scene.add(g)
}
