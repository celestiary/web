import React, {ReactElement, useEffect} from 'react'
import ThreeUi from '../ThreeUI.js'
import {grid} from '../shapes.js'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Grid() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>A Grid</h1>
      <div id={uiId}></div>
      <p>Try zooming out and rotating.</p>
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
