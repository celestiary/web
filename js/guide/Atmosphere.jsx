import React from 'react'
import {AxesHelper, PointLight} from 'three'
import ThreeUi from '../ThreeUI.js'
import {elt} from '../utils.js'
import cAtmosphere from './Atmosphere.js'
import AtmosphereControls from './AtmosphereControls.js'
import AtmosphereMesh from './AtmosphereMesh.js'
import {ui as uiId} from './index.module.css'


// TODO: args need to be hand sync'd with AtmosphereControls.PRESETS.
// Earth, Terrell's original.
// const atmos = new Atmosphere(0.5, 22, 6371000, 100000,
//                              5.5e-6, 13.0e-6, 22.4e-6, 8000,
//                              0.000021, 1200, 0.758);

// Collienne et al., diffs: Rayleigh and scale height

/** @returns {React.ReactElement} */
export default function Atmosphere() {
  React.useEffect(() => {
    setup()
  })
  return (
    <>
      <h1>Atmosphere</h1>
      <div id={uiId}></div>
      <p><em>Work in progress.</em></p>

      <p>Using <a target="_new" href="https://github.com/wwwtyro/glsl-atmosphere">Rye Terrell's
        atmosphere shaders</a> with some physical constants and equation
        corrections adopted from <a href="bruneton-atmos/index.html">my
        attempt to integrate Eric Bruneton's shaders</a>.
        See <a href="https://github.com/celestiary/web/blob/master/howto/atmosphere.html">source</a> for
        extended notes on physical parameters.</p>

      <p>Try zooming out (mouse scroll or pad push) to see the change in eye
        height.  Currently working on parameterizing the sun position and
      camera look direction.</p>

      <div id="control" style={{width: 400, height: 400}}></div>
    </>)
}


function setup() {
  const atmos = new cAtmosphere(2, 22, 6371000, 60000,
      5.8e-6, 13.5e-6, 33.1e-6, 8000,
      0.000021, 1200, 0.8)

  const atmosControls = new AtmosphereControls(elt('control'), atmos)

  const ui = new ThreeUi(uiId)
  ui.camera.position.z = 10
  const light = new PointLight()
  const dist = 1e7
  light.position.set(dist, 0, dist)
  ui.scene.add(light)
  ui.scene.add(new AxesHelper(1.1))
  ui.scene.add(new AtmosphereMesh(atmos))
  const animation = () => {
    const cameraPosition = ui.camera.position.clone()
    cameraPosition.applyMatrix4(ui.camera.matrixWorld)
    atmos.EyeHeight = atmos.GroundElevation + cameraPosition.z
  }
  ui.setAnimation(animation)
}
