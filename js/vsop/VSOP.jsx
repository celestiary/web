import React, {useEffect, useState} from 'react'
import {useParams} from 'react-router-dom'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'


/**
 * @property {boolean} index Use a default time instead of useParam day
 * @returns {React.ReactElement}
 */
export default function VSOP({isIndex = false}) {
  const [vsop87c, setVsop87c] = useState(null)
  const [planetCoords, setPlanetCoords] = useState(null)

  const {day} = useParams()


  useEffect(() => {
    loadVsop87c((v) => {
      setVsop87c(v)
      setPlanetCoords(v(isIndex ? 0 : parseInt(day || 0)))
    })
  }, [day, isIndex, planetCoords, setPlanetCoords, setVsop87c, vsop87c])


  return (
    <>
      <h1>Julian Day: {day}</h1>
      See <a href='https://en.wikipedia.org/wiki/Julian_day' target='_new'>https://en.wikipedia.org/wiki/Julian_day</a>
      <pre>{JSON.stringify(planetCoords, null, 2)}</pre>
    </>
  )
}


/**
 * @param {Function} callback Passed vsop87c function when it's ready
 */
export function loadVsop87c(onLoad) {
  vsop87cLoader.then((vsop87c) => {
    onLoad(vsop87c)
  })
}
