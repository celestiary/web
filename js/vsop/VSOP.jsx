import React, {useEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useParams} from 'react-router-dom'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {Html, OrbitControls} from '@react-three/drei'
import {Canvas} from '@react-three/fiber'
import {toJulianDay} from '../Time.js'
import './labels.css'


/**
 * @property {boolean} index Use a default time instead of useParam day
 * @returns {React.ReactElement}
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
      console.log('julianDate', julianDate)
      const daysCoords = vsop87c(julianDate)
      setPlanetCoords(daysCoords)
      doCreateRoot({planetCoords: daysCoords})
    })
  }, [dayParam, setDay, isIndex, setPlanetCoords])


  return (
    <>
      <ViewerContainer/>
      <h1>Julian Day: {day}</h1>
      <div>See
        <a
          href='https://en.wikipedia.org/wiki/Julian_day'
          target='_new'
        >
          https://en.wikipedia.org/wiki/Julian_day
        </a>
        <pre>{JSON.stringify(planetCoords, null, 2)}</pre>
      </div>
    </>)
}


/**
 * @param {Function} callback Passed vsop87c function when it's ready
 */
export function loadVsop87c(onLoad) {
  vsop87cLoader.then((vsop87c) => {
    onLoad(vsop87c)
  })
}


/** */
export function doCreateRoot({planetCoords}) {
  createRoot(document.getElementById('viewer-container')).render(<SolarSystem planetCoords={planetCoords}/>)
}


/** @returns {React.ReactElement} */
function ViewerContainer() {
  return (
    <div
      id='viewer-container'
      style={{
        position: 'absolute',
        top: '0px',
        left: '0px',
        textAlign: 'center',
        width: '100vw',
        height: '100vh',
        margin: 'auto',
      }}
    />
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
    <>
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
                scale * -coord[1].x,
                scale * coord[1].z,
                scale * coord[1].y,
              ]}
            />
          )
        })}
        <OrbitControls/>
      </Canvas>
    </>
  )
}
