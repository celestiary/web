import React, {ReactElement, useEffect, useState} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import {Shape} from 'three'
import StarFromApp from '../Star.js'
import StarsCatalog, {FAVES, StarSpectra} from '../StarsCatalog.js'
import ThreeUi from '../ThreeUI.js'
import Time from '../Time.js'
import * as Shared from '../shared.js'
import {ui as uiId} from './index.module.css'


/** @returns {ReactElement} */
export default function Star() {
  const [ui, setUi] = useState(null)
  const [star, setStar] = useState(null)
  const [catalog, setCatalog] = useState(null)

  const [hashLocation] = useHashLocation()


  useEffect(() => setUi(setup(setCatalog)), [])


  useEffect(() => {
    if (ui && catalog) {
      const starName = hashLocation.substr(1)
      const time = new Time()
      showStar(ui, starName, star, setStar, catalog, time)
    }
  }, [catalog, hashLocation, ui, setStar])


  return (
    <>
      <h1>Star</h1>
      <div id={uiId}></div>
      <p>See <a href='https://www.seedofandromeda.com/blogs/51-procedural-star-rendering'>Seed
          of Andromeda</a> for a nice overall approach.</p>

      <p>Borrowed heavily from
      code <a href='https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/'>here</a>.</p>

      <p>Added differential color range based on distance.  This makes the
        star appear white from far away and reveal surface structure as
        false-color on closer approach.</p>

      <table id='faves'>
        <tbody>
          <tr><th>Star</th><th>Spectral Type</th><th>Hip ID</th></tr>
          {catalog && Array.from(FAVES.keys()).map((hipId) => {
            const name = FAVES.get(hipId)
            const catStar = catalog.starByHip.get(hipId)
            const spectralType = StarSpectra[catStar.spectralType][3]
            return (
              <tr key={`${hipId}`}>
                <td><a href={`#${name}`}>{name}</a></td>
                <td>{spectralType}</td>
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
  const star = addStarToScene(ui, catalog, parseInt(hipId), curStar, setStar)
  ui.camera.position.z = star.initialCameraDistance
  ui.animationCb = () => {
    time.updateTime()
    try {
      star.preAnimCb(time)
    } catch (e) {
      console.error(e)
      throw new Error(`preanim star: ${star}`)
    }
  }
}


/**
 * Draw the star on the canvas
 *
 * @returns {Shape} star
 */
function addStarToScene(ui, catalog, hipId, curStar, setStar) {
  if (curStar) {
    ui.scene.remove(curStar)
  }
  const starProps = catalog.starByHip.get(hipId)
  starProps.x = starProps.y = starProps.z = 0
  starProps.radius = {scalar: starProps.radius}
  const star = new StarFromApp(starProps, {}, ui)
  ui.scene.add(star)
  setStar(star)
  return star
}
