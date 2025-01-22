import React, {ReactElement, useEffect} from 'react'
import {
  AmbientLight,
  PointLight,
  Raycaster,
  Vector3,
} from 'three'
import ThreeUi from '../ThreeUI.js'
import {sphere} from '../shapes.js'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Picking() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>Picking</h1>
      <div id={uiId}></div>
      <p>Click on the sphere to change its colors.</p>
    </>
  )
}


/** Initialize threejs helpers and setup picking */
function setup() {
  const ui = new ThreeUi(uiId)
  const light = new PointLight
  light.position.set(10, 10, 10)
  ui.scene.add(light)
  ui.scene.add(new AmbientLight(0x888888))

  // Test a complex scene graph to show that picking is compatible with
  // object and camera offsets.
  const a = sphere(); const b = sphere(); const c = sphere()
  a.position.set(5, 3, 2)
  b.position.set(2, 5, 3)
  c.position.set(2, 3, 5)
  ui.scene.add(a)
  ui.scene.add(b)
  ui.scene.add(c)

  ui.camera.platform.position.z = 10
  ui.camera.position.z = 1

  // I think lookAt just works, unless camera is controlled, in which
  // case controls.target needs to be set to worldMatrix position of target
  // obj.
  ui.scene.updateMatrixWorld()
  const sPos = new Vector3
  sPos.setFromMatrixPosition(a.matrixWorld)
  ui.camera.lookAt(sPos)
  ui.controls.update()
  ui.controls.target = sPos

  const raycaster = new Raycaster
  const colorAlts = [0xff0000, 0x00ff00]
  let colorNdx = 0
  document.body.addEventListener('dblclick', (event) => {
    const mouse = {}
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    mouse.y = (event.clientY / window.innerHeight) * -2 + 1
    raycaster.setFromCamera(mouse, ui.camera)
    const intersects = raycaster.intersectObjects(ui.scene.children, true)
    console.log('click intersects: ', intersects)
    for (let i = 0; i < intersects.length; i++) {
      const obj = intersects[i].object
      obj.material.color.set(colorAlts[colorNdx])
      colorNdx = (colorNdx + 1) % 2
    }
  })
}
