import React, {ReactElement, useEffect, useState} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import {AxesHelper, MeshBasicMaterial, PointLight} from 'three'
import ThreeUi from '../ThreeUI'
import * as Shapes from '../shapes'
import {LENGTH_SCALE, ASTRO_UNIT_METER} from '../shared'
import {planetHelper} from '../scene_utils'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Planet() {
  const [ui, setUi] = useState(null)
  const [planet, setPlanet] = useState(null)
  const [hashLocation] = useHashLocation()

  useEffect(() => setUi(setup()), [])

  useEffect(() => {
    if (ui) {
      const planetName = (hashLocation === '/' ? '#earth' : hashLocation).substring(1)
      showPlanet(ui, planetName, planet, setPlanet)
    }
  }, [hashLocation, ui])

  return (
    <>
      <h1>Planet</h1>
      <div id={uiId}></div>
      <p>Use LOD to lazy-load texture.  Open your browser network trace and
      watch it as you zoom in.</p>
      <table id='faves'>
        <tbody>
          <tr><th>Name</th></tr>
        </tbody>
      </table>
    </>
  )
}



/**
 * Initialize threejs helpers and load angles
 *
 * @returns {object}
 */
function setup() {
  const planetNames = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
  const favesTable = document.getElementById('faves')
  favesTable.innerHTML = '<tr><th>Planet</th></tr>'
  planetNames.map((planetName) => {
    favesTable.innerHTML +=
          `<tr>
            <td><a href="#${planetName.toLowerCase()}">${planetName}</a></td>
          </tr>`
  })

  const ui = new ThreeUi(uiId)
  if (true) {
    const sunLumensSurface = 3.7e28 // Sun lumens
    const sunFilter = 1e-5
    const sunlight = new PointLight(0xffffff, sunLumensSurface * sunFilter, 0)
    const dist = ASTRO_UNIT_METER
    sunlight.position.set(-dist, dist, dist)
    ui.scene.add(sunlight)
  }
  if (false) {
    const cameraLight = new PointLight(0xffffff, 1e19, 0)
    const dist = 1e6
    cameraLight.position.set(dist, dist, dist)
    ui.camera.add(cameraLight)
  }

  return ui
}


/** Invokes planeHelper */
function showPlanet(ui, path, curPlanet, setPlanet) {
  planetHelper(path, (p) => {
    if (curPlanet) {
      ui.scene.remove(curPlanet)
    }
    p.add(new AxesHelper)
    const radius = p.props.radius.scalar
    // p.scale.setScalar(1/radius)
    console.log(`planet:`, p, radius)
    ui.camera.position.z = radius * 3e0
    ui.scene.add(p)
    ui.scene.add(new AxesHelper)
    setPlanet(p)
    ui.animationCb = () => {
      p.rotation.y += 0.001
    }
  })
}
