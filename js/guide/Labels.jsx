import React, {useEffect} from 'react'
import {PointLight} from 'three'
import SpriteSheet from '../SpriteSheet.js'
import ThreeUi from '../ThreeUI.js'
import {cube} from '../shapes.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Labels() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>Sprite Sheet Labels</h1>
      <div id={uiId}></div>
      <p>To allow for more labels in the scene, a single sprite sheet is
        used, with a GL shader configured with custom offsets into the sheet
        for each object.</p>
    </>)
}


/** Initialize threejs helpers and load labels */
function setup() {
  const ui = new ThreeUi(uiId)

  const c = cube()
  c.position.z = -3
  ui.scene.add(c)
  const light = new PointLight()
  light.position.set(10, 10, 10)
  ui.scene.add(light)

  const prefix = 'item-'
  const num = 10000
  ui.camera.position.set(0, 0, 10)
  const labels = new SpriteSheet(num, prefix + num, 'medium arial')
  const size = Math.ceil(Math.sqrt(num))
  const xOff = size / -2 + 0.5; const yOff = size / -2 + 0.5
  out:
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const id = i * size + j
      if (id >= num) {
        break out
      }
      labels.add(xOff + i, yOff + j, 0, prefix + id)
    }
  }
  ui.scene.add(labels.compile())
}
