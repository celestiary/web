import React, {useEffect, useState} from 'react'
import {useHashLocation} from 'wouter/use-hash-location'
import {Shape} from 'three'
import StarFromApp from '../Star.js'
import StarsCatalog, {FAVES} from '../StarsCatalog.js'
import ThreeUi from '../ThreeUI.js'
import Time from '../Time.js'
import * as Shared from '../shared.js'
import {ui as uiId} from './index.module.css'


/** @returns {React.ReactElement} */
export default function Star() {
  const [ui, setUi] = useState(null)
  const [star, setStar] = useState(null)
  const [catalog, setCatalog] = useState(null)

  const [hashLocation] = useHashLocation()


  useEffect(() => {
    setUi(setup(setCatalog))
  }, [])


  useEffect(() => {
    console.log('guide/Star, useEffect: ', hashLocation)
    if (ui && catalog) {
      const starName = hashLocation.substr(1)
      const time = new Time()
      showStar(ui, starName, star, setStar, catalog, time)
    }
  }, [ui, setStar, catalog, hashLocation])


  return (
    <>
      <div id={uiId}></div>
      <h1>Star</h1>
      See <a href='https://www.seedofandromeda.com/blogs/51-procedural-star-rendering'>Seed
          of Andromeda</a> for a nice overall approach.

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
            const spectralType = StarsCatalog.StarSpectra[catStar.spectralType][3]
            return (
              <tr>
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
  ui.camera.position.z = 3.5
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
  starProps.radius = {
    // Sun's radius in meters.
    scalar: 1 / Shared.LENGTH_SCALE,
  }
  const star = new StarFromApp(starProps, {}, ui)
  ui.scene.add(star)
  setStar(star)
  return star
}
