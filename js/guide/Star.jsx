import React, {ReactElement, useEffect, useState} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import {addStarToScene, frameStar} from './starScene.js'
import StarsCatalog, {FAVES} from '../scene/StarsCatalog.js'
import {spectralTypeName, starTeff} from '../scene/stellar.js'
import ThreeUi from '../ThreeUI.js'
import Time from '../Time.js'
import * as Shared from '../shared.js'
import {ui as uiId} from './index.module.css'


/** The star shown when the URL has no hash. */
const DEFAULT_STAR = 'Sol'


/** @returns {ReactElement} */
export default function Star() {
  const [ui, setUi] = useState(null)
  const [star, setStar] = useState(null)
  const [catalog, setCatalog] = useState(null)

  const [hashLocation] = useHashLocation()


  useEffect(() => setUi(setup(setCatalog)), [])


  useEffect(() => {
    if (ui && catalog) {
      const starName = hashLocation.substr(1) || DEFAULT_STAR
      const time = new Time()
      showStar(ui, starName, star, setStar, catalog, time)
    }
  }, [catalog, hashLocation, ui, setStar])


  return (
    <>
      <h1>Star</h1>
      <div id={uiId}></div>
      <p>Each star is drawn from its physical parameters: its effective
        temperature from its spectral class gives its colour (a blackbody
        through the CIE observer), its surface brightness and its limb
        darkening; its granulation, spots and faculae follow from its
        temperature and gravity.  See <code>js/scene/Stars.md</code>.</p>

      <table id='faves'>
        <tbody>
          <tr><th>Star</th><th>Spectral Type</th><th>T<sub>eff</sub> (K)</th><th>Hip ID</th></tr>
          {catalog && Array.from(FAVES.keys()).map((hipId) => {
            const name = FAVES.get(hipId)
            const catStar = catalog.starByHip.get(hipId)
            return (
              <tr key={`${hipId}`}>
                <td><a href={`${window.location.pathname}#${name}`}>{name}</a></td>
                <td>{spectralTypeName(catStar)}</td>
                <td>{Math.round(starTeff(catStar))}</td>
                <td>{hipId}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>)
}


/** @returns {ThreeUi} */
function setup(setCatalog) {
  const ui = new ThreeUi(uiId)
  ui.configLargeScene()
  const catalog = new StarsCatalog()
  catalog.load(() => setCatalog(catalog))
  return ui
}


/** Called when user selects star from table */
function showStar(ui, path, curStar, setStar, catalog, time) {
  path = path.replaceAll(/%20/g, ' ')
  const hipId = catalog.hipByName.get(path)
  if (hipId === undefined) {
    console.error(`Cannot find star(${path}) in `, catalog)
    return
  }
  const star = addStarToScene(ui, catalog, parseInt(hipId), path, curStar, setStar)
  // The disc fills 90% of the canvas's smaller dimension, and stays so
  // through a resize until the user zooms.
  const reframe = frameStar(ui, star)
  ui.animationCb = () => {
    reframe()
    time.updateTime()
    try {
      star.preAnimCb(time)
    } catch (e) {
      console.error(e)
      throw new Error(`preanim star: ${star}`)
    }
  }
}
