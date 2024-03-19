import React, {ReactElement, useEffect, useState} from 'react'
import {useLocation} from 'wouter'
import {PointLight} from 'three'
import ThreeUi from '../ThreeUI.js'
import {planetHelper} from '../scene_utils.js'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Planet() {
  const [ui, setUi] = useState(null)
  const [planet, setPlanet] = useState(null)

  const [location] = useLocation()


  useEffect(() => setUi(setup()), [])


  useEffect(() => {
    if (ui) {
      const path = (location.hash || '#earth').substr(1)
      showPlanet(ui, path, planet, setPlanet)
    }
  }, [ui, location])


  return (
    <>
      <div id={uiId}></div>
      <h1>Planet</h1>
      <p>Use LOD to lazy-load texture.  Open your browser network trace and
      watch it as you zoom in.</p>
      <table id='faves'>
        <tbody>
          <tr><th>Name</th></tr>
        </tbody>
      </table>
    </>)
}


/**
 * Initialize threejs helpers and load angles
 *
 * @returns {object}
 */
function setup() {
  const ui = new ThreeUi(uiId)
  ui.camera.position.z = 1e1
  const light = new PointLight()
  light.power = 1.7e1
  const dist = 1e3
  light.position.set(-dist, 0, dist)
  ui.camera.add(light)
  return ui
}


/** Invokes planeHelper */
function showPlanet(ui, path, curPlanet, setPlanet) {
  planetHelper(path, (p) => {
    if (curPlanet) {
      ui.scene.remove(curPlanet)
    }
    ui.scene.add(p)
    setPlanet(p)
    ui.animationCb = () => {
      p.rotation.y += 0.001
    }
  })
}
