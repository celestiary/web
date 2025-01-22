import React, {ReactElement, useEffect, useState} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import {MeshBasicMaterial, PointLight} from 'three'
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
      console.log('hashLocation:', hashLocation)
      const planetName = (hashLocation === '/' ? '#earth' : hashLocation).substring(1)
      console.log('planetName:', planetName, hashLocation)
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
  ui.configLargeScene()
  const sunLumensSurface = 3.7e28 // Sun lumens
  const sunlight = new PointLight(0xffffff, sunLumensSurface, 0)
  const dist = ASTRO_UNIT_METER
  sunlight.position.set(-dist, dist, dist)
  ui.scene.add(sunlight)
  return ui
}


/** Invokes planeHelper */
function showPlanet(ui, path, curPlanet, setPlanet) {
  planetHelper(path, (p) => {
    if (curPlanet) {
      ui.scene.remove(curPlanet)
    }
    const radius = p.props.radius.scalar
    ui.camera.position.z = p.initialCameraDistance
    ui.scene.add(p)
    setPlanet(p)
    ui.animationCb = () => {
      p.rotation.y += 0.001
    }
  })
}
