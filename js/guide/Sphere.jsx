import React, {useEffect} from 'react'
import {MeshBasicMaterial, PointLight} from 'three'
import ThreeUi from '../ThreeUI.js'
import {sphere} from '../shapes.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Sphere() {
  useEffect(() => setup(), [])
  return (
    <>
      <div id={uiId}></div>
      <h1>A Sphere</h1>
      Or is it a fully operational battlestation?!
    </>)
}


/** Initialize threejs helpers and load sphere */
function setup() {
  const ui = new ThreeUi(uiId)
  // Pull the camera back from center 10 units along the z-axis
  // (towards the viewer).
  ui.camera.position.set(1, 2, 3)

  // Create a light and move away 10 units from the center along
  // each axis to give // interesting lighting.
  const light = new PointLight(0xffffff, 1, 0)
  light.position.set(3, 4, 5)
  light.power = 1700
  ui.scene.add(light)

  const radius = 1
  const resolution = 50
  const matr = new MeshBasicMaterial({
    color: 0xff0000,
    wireframe: true,
  })
  ui.scene.add(sphere({radius, resolution, matr}))
}
