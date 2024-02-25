import React, {useEffect} from 'react'
import {Route, Link, useLocation} from 'wouter'
import Angles from './Angles'
import Asterisms from './Asterisms'
import Atmosphere from './Atmosphere'
import Cube from './Cube'
import Sphere from './Sphere'
import Galaxy from './Galaxy'
import Grid from './Grid'
import Labels from './Labels'
import Loader from './Loader'
import Measure from './Measure'
import Orbit from './Orbit'
import Picking from './Picking'
import Planet from './Planet'
import SaturnEarth from './SaturnEarth'
import Star from './Star'
import Stars from './Stars'
import VSOP from './VSOP'
import Welcome from './Welcome'
import {setTitleFromLocation} from '../utils.js'
import styles from './index.module.css'

// import Map from './Map'
// import SphereMap from './SphereMap'
// import Wind from './Wind'
// import StarsPicking from './StarsPicking'
// import Asteroids from './Asteroids'


/** @returns {React.ReactElement} */
export default function Guide() {
  const [location] = useLocation()


  useEffect(() => {
    setTitleFromLocation(location, 'Guide')
  }, [location])


  return (
    <table id={styles.nav}>
      <tbody>
        <tr>
          <td
            style={{
              width: '15%',
              overflowY: scroll,
              verticalAlign: 'top',
              padding: '0 1em',
            }}
          >
            <h1>Guide</h1>
            <p><Link to='~/'>← Back</Link></p>
            <ol>
              <li><Link to='/'>Welcome</Link></li>
              <li>Data
                <ol>
                  <li><Link to='/loader'>Loader</Link></li>
                  <li><Link to='/measure'>Measure</Link></li>
                </ol>
              </li>
              <li>Scene Objects
                <ol>
                  <li>Basic Shapes
                    <ul>
                      <li><Link to='/cube'>Cube</Link></li>
                      <li><Link to='/sphere'>Sphere</Link></li>
                    </ul>
                  </li>
                </ol>
              </li>
              <li>Decorators
                <ul>
                  <li><Link to='/grid'>Grid</Link></li>
                  <li><Link to='/labels'>Labels</Link></li>
                  <li><Link to='/angles'>Angles</Link></li>
                </ul>
              </li>
              <li>Interaction
                <ul><li><Link to='/picking'>Picking</Link></li></ul>
              </li>
              <li>Celestial Bodies
                <ul>
                  <li><Link to='/stars'>Stars</Link></li>
                  <li><Link to='/star'>Star</Link></li>
                  <li><Link to='/asterisms'>Asterisms</Link></li>
                  <li><Link to='/planet'>Planet</Link></li>
                </ul>
              </li>
              <li><Link to='/atmosphere'>Atmosphere</Link></li>
              <li>Celestial Mechanics
                <ul>
                  <li><Link to='/orbit'>Orbit</Link></li>
                  <li><Link to='/vsop'>VSOP</Link></li>
                  <li><Link to='/galaxy'>Gravity (galaxy)</Link></li>
                  {/* <li><Link to='/saturn-earth'>Saturn-Earth demo</Link></li>*/}
                </ul>
              </li>
              <li>Fun
                <ul>
                  <li><Link to='/saturn-earth'>Earth, Saturn's moon</Link></li>
                </ul>
              </li>
              {/* <li>Earth:
                  <ul>
                  <li><Link to='/map'>Map</Link></li>
                  <li><Link to='/sphere-map'>Sphere map</Link></li>
                  <li><Link to='/wind'>Wind map</Link></li>
                  </ul>
                  </li>*/}
            </ol>
          </td>
          <td>
            <Route path='/'><Welcome/></Route>
            <Route path='/angles'><Angles/></Route>
            <Route path='/atmosphere'><Atmosphere/></Route>
            <Route path='/cube'><Cube/></Route>
            <Route path='/sphere'><Sphere/></Route>
            <Route path='/galaxy' nest><Galaxy/></Route>
            <Route path='/grid'><Grid/></Route>
            <Route path='/labels'><Labels/></Route>
            <Route path='/loader'><Loader/></Route>
            <Route path='/measure'><Measure/></Route>
            <Route path='/orbit'><Orbit/></Route>
            <Route path='/vsop'><VSOP/></Route>
            <Route path='/picking'><Picking/></Route>
            <Route path='/saturn-earth'><SaturnEarth/></Route>
            <Route path='/stars'><Stars/></Route>
            <Route path='/star'><Star/></Route>
            <Route path='/asterisms'><Asterisms/></Route>
            <Route path='/planet'><Planet/></Route>
          </td>
        </tr>
      </tbody>
    </table>)
}


{/*
<Route path='/map'><Map/></Route>
<Route path='/sphere-map'><SphereMap/></Route>
<Route path='/wind'><Wind/></Route>
 */}
