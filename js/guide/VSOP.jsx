import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {Link, useParams} from 'wouter'
import {Html, OrbitControls} from '@react-three/drei'
import {Canvas} from '@react-three/fiber'
import {toJulianDay} from '../Time'
import {loadVsop87c} from '../vsop'
import {ui as uiId} from './index.module.css'
import './vsopLabels.css'


/**
 * @property {boolean} index Use a default time instead of useParam day
 * @returns {ReactElement}
 */
export default function VSOP({isIndex = false}) {
  const [planetCoords, setPlanetCoords] = useState(null)
  const [day, setDay] = useState(0)

  const {day: dayParam} = useParams()

  useEffect(() => {
    loadVsop87c((vsop87c) => {
      const now = Date.now()
      const nowJulian = toJulianDay(now)
      const julianDate = isIndex ? nowJulian : parseInt(dayParam || nowJulian)
      setDay(julianDate)
      const daysCoords = vsop87c(julianDate)
      setPlanetCoords(daysCoords)
    })
  }, [dayParam, setDay, isIndex, setPlanetCoords])

  return (
    <div style={{'user-select': 'none'}}>
      <h1>VSOP</h1>
      {planetCoords && <ViewerContainer id={uiId} planetCoords={planetCoords}/>}
      <p>The semi-analytic planetary theory VSOP
        <a href='https://en.wikipedia.org/wiki/VSOP_model' target='_new'>Variations
        Séculaires des Orbites Planétaires (VSOP)</a> is a mathematical model describing
        long-term changes (secular variation) in the orbits of the planets Mercury to Neptune.</p>
      <p>The theory is implemented by the <a href='https://github.com/gmarty/vsop87'
                                             target='_new'>vsop87</a> library.</p>
      <p>See <a href='https://en.wikipedia.org/wiki/Julian_day' target='_new'>
          https://en.wikipedia.org/wiki/Julian_day
        </a>
      </p>
      <p>Add /[number] to go to that day, e.g. <Link to='/vsop/0'>/0</Link></p>
      <p>Simulation Julian Day: {day}</p>
      <p>Coordinates: <span style={{whiteSpace: 'pre'}}>{JSON.stringify(planetCoords, null, 2)}</span></p>
    </div>
  )
}


/** @returns {ReactElement} */
function ViewerContainer({id, planetCoords}) {
  return (
    <div id={id} style={{width: '400px', height: '400px'}}>
      <SolarSystem planetCoords={planetCoords}/>
    </div>
  )
}


/**
 * @param {object} props
 * @returns {React.ReactElement}
 */
function Planet(props) {
  // This reference will give us direct access to the mesh
  const meshRef = useRef()
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false)
  const [active, setActive] = useState(false)
  // Subscribe this component to the render-loop, rotate the mesh every frame
  // useFrame((state, delta) => (meshRef.current.rotation.x += delta))
  // Return view, these are regular three.js elements expressed in JSX
  return (
    <mesh
      {...props}
      ref={meshRef}
      scale={active ? 1.5 : 1}
      onClick={(event) => setActive(!active)}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}
    >
      <sphereGeometry args={[props.radius || 0.1, 32, 16]}/>
      <meshStandardMaterial
        color={hovered ? 'hotpink' : 'white'}
        emissive={(props.name === 'sun' ? 'yellow' : 'black')}/>
      <Html className='label'>{props.name}</Html>
    </mesh>
  )
}


/** @returns {React.ReactElement} */
function SolarSystem({planetCoords}) {
  const scale = 2
  return (
    <Canvas frameloop='demand'>
      <ambientLight intensity={0.01}/>
      <pointLight position={[0, 0, 0]} decay={0} intensity={Math.PI}/>
      <Planet position={[0, 0, 0]} radius={0.2} name={'sun'}/>
      {Object.entries(planetCoords).map((coord, index) => {
        // console.log('coord', coord)
        return (
          <Planet
            key={index}
            name={coord[0]}
            position={[
              scale * coord[1].x,
              scale * coord[1].z,
              scale * coord[1].y,
            ]}
          />
        )
      })}
      <OrbitControls/>
    </Canvas>
  )
}
