import React, {useEffect} from 'react'
import cMeasure from '@pablo-mayrgundter/measure.js'
import {elt, newElt} from '../utils.js'


export default function Measure() {
  useEffect(() => {
    setup()
  }, [])
  return (
    <>
      <h1>Measure</h1>

      <p>Working with astronomical data will quickly break ur brain
        if you don't have an easy way to work with units and mangitudes.
        I wrote the <a href="https://github.com/pablo-mayrgundter/measure.js">measure.js</a> library
        to help with this.</p>
      <table cellPadding="5em" cellSpacing="5">
        <tbody>
          <tr><th>Data string</th><th>Parsed Measure toString</th><th>toKilo</th></tr>
          <tr><td id="mass1">1.9891E33 g</td></tr>
          <tr><td id="mass2">1.9891E33 kg</td></tr>
          <tr><td id="radius">6.9424895E8 m</td></tr>
        </tbody>
      </table>
    </>
  )
}

function setup() {
  const parse = (elt) => {
    const origText = elt.innerHTML
    const measure = cMeasure.parse(elt.innerHTML)
    const asKilo = measure.convertTo(cMeasure.Magnitude.KILO)
    const p = elt.parentNode
    p.appendChild(newElt('td', measure))
    p.appendChild(newElt('td', asKilo))
  }
  parse(elt('mass1'))
  parse(elt('mass2'))
  parse(elt('radius'))
}
