import React, {ReactElement, useEffect, useMemo, useState} from 'react'
import {Html, OrbitControls} from '@react-three/drei'
import {Canvas, useFrame} from '@react-three/fiber'
import {J2000_JD} from '../scene/celestialFrame.js'
import {eccentricAnomaly} from '../scene/meanElements.js'
import OrbitDiagram from '../scene/orbitDiagram.js'
import {ORBIT_ELEMENTS, elementsOfDate, formatDistance, norm360} from '../scene/orbitElements.js'
import {PLANET_NAMES} from '../scene/planetsApprox.js'
import {capitalize} from '../utils.js'


// The six orbital elements, one at a time: sliders set them, and hovering
// or clicking a row lights its part of the diagram, as the app's info panel
// does for a body's orbit (DESIGN.md "Orbital elements").


const TO_RAD = Math.PI / 180
const SECONDS_PER_ORBIT = 12
const FIGURE = {name: 'Figure', a: null, e: 0.3, i: 30, node: 300, peri: 50, meanLongitude: 90}
const PRESETS = [FIGURE, ...PLANET_NAMES.map((name) => {
  const el = elementsOfDate(name, {eccentricity: 0}, J2000_JD)
  return {name: capitalize(name), a: el.a, e: el.e, i: el.i, node: el.node, peri: el.peri,
    meanLongitude: el.meanLongitude}
})]
const SLIDERS = {
  eccentricity: {field: 'e', min: 0, max: 0.95, step: 0.001},
  inclination: {field: 'i', min: 0, max: 180, step: 0.1},
  longitudeOfAscendingNode: {field: 'node', min: 0, max: 360, step: 0.1},
  longitudeOfPericenter: {field: 'peri', min: 0, max: 360, step: 0.1},
  meanLongitude: {field: 'meanLongitude', min: 0, max: 360, step: 0.1},
}
const LABEL_STYLE = {whiteSpace: 'nowrap', fontSize: 'small', color: '#ddd', pointerEvents: 'none'}
const ROWS = ['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode', 'longitudeOfPericenter',
  'meanLongitude', 'argumentOfPericenter', 'meanAnomaly']


/**
 * The diagram's elements from the page's: ω = ϖ - Ω, M = L - ϖ, and ν.
 *
 * @param {object} s
 * @returns {object}
 */
function diagramElements(s) {
  const w = norm360(s.peri - s.node)
  const m = norm360(s.meanLongitude - s.peri)
  const E = eccentricAnomaly(m * TO_RAD, s.e)
  const nu = norm360(2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2)) / TO_RAD)
  return {e: s.e, i: s.i, node: s.node, w, m, nu}
}


/** @returns {ReactElement} */
export default function Orbit() {
  const [state, setState] = useState(FIGURE)
  const [hovered, setHovered] = useState(null)
  const [pinned, setPinned] = useState(null)
  const [running, setRunning] = useState(false)
  const diagram = useMemo(() => new OrbitDiagram({body: true, screen: true}), [])
  const el = diagramElements(state)
  const lit = hovered ?? pinned
  // In render, so the labels below read this state's anchors.
  diagram.setElements(el)

  useEffect(() => diagram.highlight(lit), [diagram, lit])
  useEffect(() => () => diagram.dispose(), [diagram])

  const values = {
    semiMajorAxis: state.a ? formatDistance(state.a) : '1 (the unit)',
    eccentricity: state.e.toFixed(3),
    inclination: `${state.i.toFixed(1)}°`,
    longitudeOfAscendingNode: `${state.node.toFixed(1)}°`,
    longitudeOfPericenter: `${state.peri.toFixed(1)}°`,
    meanLongitude: `${state.meanLongitude.toFixed(1)}°`,
    argumentOfPericenter: `${el.w.toFixed(1)}° = ϖ − Ω`,
    meanAnomaly: `${el.m.toFixed(1)}° = L − ϖ`,
  }

  return (
    <>
      <h1>Orbit</h1>
      <p>Six numbers place a body on a Kepler orbit: its size <b>a</b> and shape <b>e</b>, the tilt <b>i</b> and
        turn <b>Ω</b> of its plane, where in that plane it comes closest (<b>ϖ</b>, or <b>ω</b> from the node), and
        where the body is (<b>L</b>, or <b>M</b> from pericentre).  Hover or click an element to light it.  The
        app does the same for any body: open its info panel&apos;s <i>orbit</i> list.
        See <a href="https://en.wikipedia.org/wiki/Orbital_elements">Orbital elements</a>.</p>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '1em', alignItems: 'flex-start'}}>
        <div style={{width: 'min(640px, 100%)', height: '480px', background: 'black'}}>
          <Canvas camera={{position: [1.9, 1.8, 3.1], fov: 45, near: 0.01, far: 100}}>
            <primitive object={diagram}/>
            <Labels diagram={diagram}/>
            {running && <Run setState={setState}/>}
            <OrbitControls/>
          </Canvas>
        </div>
        <div>
          <label>Orbit: <select
            value={state.name}
            onChange={(ev) => setState(PRESETS.find((p) => p.name === ev.target.value))}>
            {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select></label>
          <label style={{marginLeft: '1em'}}><input type="checkbox" checked={running}
            onChange={(ev) => setRunning(ev.target.checked)}/> run</label>
          <table>
            <tbody>
              {ROWS.map((key) => {
                const info = ORBIT_ELEMENTS[key]
                const slider = SLIDERS[key]
                const isLit = lit === key
                return (
                  <tr key={key}
                    onPointerEnter={() => setHovered(key)}
                    onPointerLeave={() => setHovered(null)}
                    onClick={() => setPinned(pinned === key ? null : key)}
                    style={{cursor: 'pointer', background: isLit ? 'rgba(255,255,255,0.12)' : 'none'}}>
                    <td><span style={{color: `#${info.color.toString(16).padStart(6, '0')}`}}>■</span>
                      {' '}<b>{info.symbol}</b></td>
                    <td>{info.name}</td>
                    <td>{slider && <input type="range" min={slider.min} max={slider.max} step={slider.step}
                      value={state[slider.field]}
                      onChange={(ev) => setState({...state, name: state.name, [slider.field]: Number(ev.target.value)})}/>}
                    </td>
                    <td style={{whiteSpace: 'nowrap'}}>{values[key]}</td>
                  </tr>)
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>)
}


/**
 * The reference direction, node and pericentre, named in place.
 *
 * @param {object} props
 * @returns {ReactElement}
 */
function Labels({diagram}) {
  const an = diagram.anchors
  return (
    <>
      <Html position={an.direction.toArray()} style={{...LABEL_STYLE, transform: 'translate(-50%, -150%)'}}>♈︎ reference direction</Html>
      <Html position={an.ascendingNode.toArray()} style={LABEL_STYLE}>☊ ascending node</Html>
      <Html position={an.pericentre.toArray()} style={LABEL_STYLE}>pericentre</Html>
    </>)
}


/**
 * Runs the body round: the mean longitude at a steady rate.
 *
 * @param {object} props
 * @returns {null}
 */
function Run({setState}) {
  useFrame((_, dt) => setState((s) => ({...s, meanLongitude: norm360(s.meanLongitude + (360 * dt / SECONDS_PER_ORBIT))})))
  return null
}
