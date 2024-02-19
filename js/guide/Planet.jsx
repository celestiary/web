import React from 'react'
import {useLocation} from 'react-router-dom'
import {PointLight} from 'three'
import ThreeUi from '../ThreeUI.js'
import {planetHelper} from '../scene_utils.js'


export default function Planet() {
  const [ui, setUi] = React.useState(null)
  const [planet, setPlanet] = React.useState(null)

  React.useEffect(() => {
    setUi(setup())
  }, [])

  const location = useLocation()
  React.useEffect(() => {
    if (ui) {
      const path = (location.hash || '#earth').substr(1)
      showPlanet(ui, path, planet, setPlanet)
    }
  }, [ui, location])

  return (
    <>
      <div id="ui"></div>
      <h1>Planet</h1>
      <p>Use LOD to lazy-load texture.  Open your browser network trace and
      watch it as you zoom in.</p>
      <table id="faves">
        <tbody>
          <tr><th>Name</th></tr>
        </tbody>
      </table>
    </>)
}


function setup() {
  const ui = new ThreeUi('ui')
  ui.camera.position.z = 1e1
  const light = new PointLight()
  light.power = 1700
  const dist = 1e3
  light.position.set(-dist, 0, dist)
  ui.camera.add(light)
  return ui
}


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
