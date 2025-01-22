import React, {useEffect} from 'react'
import {AmbientLight, PointLight, Vector3} from 'three'
import Label from '../label.js'
import ThreeUi from '../ThreeUI.js'
import cOrbit from '../Orbit.js'
import * as Shared from '../shared.js'
import {planetHelper} from '../scene_utils.js'
import {angle, arrow, line} from '../shapes.js'
import {visitFilterProperty} from '../utils.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Orbit() {
  useEffect(() => setup(), [])
  return (
    <>
      <h1>Orbit</h1>
      <div id={uiId}></div>
      <p>An example orbit.<br/>
        <a href="https://en.wikipedia.org/wiki/Orbital_elements">https://en.wikipedia.org/wiki/Orbital_elements</a>
          <br/>
        <img src="/images/Orbit1.png"
          style={{width: '400px'}}
          alt="By Lasunncty at the English Wikipedia, CC BY-SA 3.0, https://commons.wikimedia.org/w/index.php?curid=8971052"/>
      </p>
      <table style={{width: '20%', verticalAlign: 'top'}}>
        <tbody>
          <tr>
            <td>
              <table id="faves"></table>
            </td>
            <td style={{width: '80%'}}>
              <form name="elts">
                <table id="propsTable"></table>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      <em style={{fontSize: 'small'}}>(<a href="#test">emulate image above</a> and refresh)</em>
    </>)
}


/** Initialize threejs helpers and load orbit */
function setup() {
  const ui = new ThreeUi(uiId)
  ui.camera.position.set(1, 1, 3)
  // ui.scene.add(new AmbientLight())
  ui.scene.add(new PointLight(0xffffff, 1e6, 0))

  function setupProps(orbitProps) {
    const tau = Math.PI * 2
    const tauInDeg = 360
    const elementMaxes = {
      siderealOrbitPeriod: 7.8184256184e9,
      eccentricity: 1,
      inclination: tauInDeg,
      longitudeOfAscendingNode: tauInDeg,
      longitudeOfPericenter: tauInDeg,
      meanLongitude: tauInDeg,
      semiMajorAxis: 5.86966e12,
    }
    document.onSlider = (sliderElt, propName, maxValue) => {
      const value = sliderElt.value / 100 * elementMaxes[propName]
      orbitProps[propName] = document.forms.elts[propName].value = value
      show(orbitProps)
    }
    document.onInput = (inputElt, propName, ma) => {
      orbitProps[propName] = inputElt.value
      document.forms.elts[propName + '-slider'].value = inputElt.value / elementMaxes[propName] * 100
      show(orbitProps)
    }
    propsTable.innerHTML = ''
    for (const propName in elementMaxes) {
      const maxValue = elementMaxes[propName]
      const propsTable = document.getElementById('propsTable')
      const value = orbitProps[propName]
      const sliderValue = value / maxValue * 100
      propsTable.innerHTML +=
        `<tr>
           <td>${propName}:
           <td><input type="range" min="0" max="100" name="${propName}-slider" value="${sliderValue}"
                  oninput="document.onSlider(this, '${propName}')"/>
           <td><input name="${propName}" value="${value}" oninput="document.onInput(this, '${propName}')"/>
         </tr>`
    }
  }


  let curOrbit; let curPlanet
  function show(orbitProps) {
    const orbit = new cOrbit(orbitProps)
    visitFilterProperty(orbit, 'name', 'referencePlane', (o) => {
      const opts = {
        text: 'Ω Longitude of ascending node',
        color: 'green',
        padding: [-0.5, -0.5],
      }
      o.add(arrow(new Vector3(1.1, 0, 0), new Vector3(), 0xff0000, '♈︎Reference direction'))
      o.add(angle(orbit.propsReified.loan, null, opts, opts))
    })
    visitFilterProperty(orbit, 'name', 'orbitalPlane', (o) => {
      const opts = {
        text: 'ω Argument of periapsis',
        color: 'blue',
        padding: [-0.5, -0.5],
      }
      const lop = orbit.propsReified.lop
      const radiusOfPeriapsis = line(1, 0, 0, {color: 'blue'})
      radiusOfPeriapsis.rotation.z = lop
      o.add(radiusOfPeriapsis)
      o.add(angle(lop, null, opts, opts))
      const an = new Label('☊ Ascending node', {fillStyle: 'green'})
      an.position.set(1, 0, 0)
      an.rotation.z = orbit.propsReified.loan
      o.add(an)
    })
    if (curOrbit) {
      ui.scene.remove(curOrbit)
    }
    curOrbit = orbit
    ui.scene.add(curOrbit)
    if (curPlanet) {
      curOrbit.addOrbiter(curPlanet)
    }
  }


  if (location.hash == '#test') {
    // Similar to graphic at https://en.wikipedia.org/wiki/Orbital_elements
    const testOrbit = {
      siderealOrbitPeriod: 0,
      eccentricity: 1,
      inclination: 30,
      longitudeOfAscendingNode: 300,
      longitudeOfPericenter: 110,
      meanLongitude: 0,
      semiMajorAxis: {scalar: 1},
    }
    setupProps(testOrbit)
    show(testOrbit)
    document.orbit = testOrbit
  } else {
    planetHelper('earth', (p) => {
      setupProps(p.props.orbit)
      show(p.props.orbit)
      curPlanet = p
      curPlanet.orbit = curOrbit
      curPlanet.scale.setScalar(1e-8)
      curOrbit.addOrbiter(curPlanet)
      console.log('planet setup done', curPlanet);
    })
  }


  const anim = () => {
    // console.log('animating...');
    const simTimeSecs = Date.now() * 1000
    // console.log('animating...', simTimeSecs);
    if (curPlanet == undefined) {
      // console.log('no system defined...');
      return
    }
    if (curPlanet.siderealRotationPeriod) {
      // console.log('has rotation!');
      // console.log(curPlanet.siderealRotationPeriod);
      // http://hpiers.obspm.fr/eop-pc/index.php?index=orientation
      const angle = 1.5 * Math.PI + simTimeSecs / 86400 * Shared.twoPi
      curPlanet.setRotationFromAxisAngle(this.Y_AXIS, angle)
    }

    // This is referred to by a comment in scene.js#addOrbitingPlanet.
    if (curPlanet.orbit) {
      const orbit = curPlanet.orbit.props
      // console.log('has orbit!', orbit);
      // TODO: orig code read this as semiMajorAxis.scalar
      const aRadius = 1
      const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(orbit.eccentricity, 2.0))
      const angle = 1.0 * simTimeSecs / orbit.siderealOrbitPeriod.scalar * Shared.twoPi
      const x = aRadius * Math.cos(angle)
      const y = bRadius * Math.sin(angle)
      const z = 0
      // console.log(`x:${x} y:${y} z:${z}`
      //            + `e:${orbit.eccentricity} a:${aRadius} b:${bRadius}`
      //            + `t:${simTimeSecs} p:${orbit.siderealOrbitPeriod}`);
      curPlanet.position.set(x, y, z)
    }
  }
  // document.anim = anim;
  ui.animationCb = anim
}
