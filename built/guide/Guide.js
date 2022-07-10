import React from 'react';
import { Routes, Route, Link, Outlet, useLocation } from 'react-router-dom';
import Angles from './Angles';
import Asterisms from './Asterisms';
import Atmosphere from './Atmosphere';
import Cube from './Cube';
import Galaxy from './Galaxy';
import Grid from './Grid';
import Labels from './Labels';
import Loader from './Loader';
import Measure from './Measure';
import Orbit from './Orbit';
import Picking from './Picking';
import Planet from './Planet';
import SaturnEarth from './SaturnEarth';
import Star from './Star';
import Stars from './Stars';
import Welcome from './Welcome';
import { setTitleFromLocation } from '../utils.js';
// import Map from './Map'
// import SphereMap from './SphereMap'
// import Wind from './Wind'
// import StarsPicking from './StarsPicking'
// import Asteroids from './Asteroids'
import './index.css';
export default function Guide() {
    const location = useLocation();
    React.useEffect(() => {
        setTitleFromLocation(location, 'Guide');
    }, [location]);
    return (<>
      <table id="nav">
        <tbody>
          <tr>
            <td style={{
            width: '15%',
            overflowY: scroll,
            verticalAlign: 'top',
            padding: '0 1em',
        }}>
              <h1>Guide</h1>
              <p><Link to="/">← Back</Link></p>
              <ol>
                <li><Link to="">Welcome</Link></li>
                <li>Data
                  <ol>
                    <li><Link to="loader">Loader</Link></li>
                    <li><Link to="measure">Measure</Link></li>
                  </ol>
                </li>
                <li>Scene Objects
                  <ol>
                    <li>Basic Shapes
                      <ul>
                        <li><Link to="cube">Cube</Link></li>
                        <li><Link to="sphere">Sphere</Link></li>
                      </ul>
                    </li>
                  </ol>
                </li>
                <li>Decorators
                  <ul>
                    <li><Link to="grid">Grid</Link></li>
                    <li><Link to="labels">Labels</Link></li>
                    <li><Link to="angles">Angles</Link></li>
                  </ul>
                </li>
                <li>Interaction
                  <ul><li><Link to="picking">Picking</Link></li></ul>
                </li>
                <li>Celestial Bodies
                  <ul>
                    <li><Link to="stars">Stars</Link></li>
                    <li><Link to="star">Star</Link></li>
                    <li><Link to="asterisms">Asterisms</Link></li>
                    <li><Link to="planet">Planet</Link></li>
                  </ul>
                </li>
                <li><Link to="atmosphere">Atmosphere</Link></li>
                <li>Celestial Mechanics
                  <ul>
                    <li><Link to="orbit">Orbit</Link></li>
                    <li><Link to="galaxy">Gravity (galaxy)</Link></li>
                    {/* <li><Link to="saturn-earth">Saturn-Earth demo</Link></li>*/}
                  </ul>
                </li>
                <li>Fun
                  <ul>
                    <li><Link to="saturn-earth">Earth, Saturn's moon</Link></li>
                  </ul>
                </li>
                {/* <li>Earth:
    <ul>
      <li><Link to="map">Map</Link></li>
      <li><Link to="sphere-map">Sphere map</Link></li>
      <li><Link to="wind">Wind map</Link></li>
    </ul>
    </li>*/}
              </ol>
            </td>
            <td>
              <Outlet />
              <Routes>
                <Route index element={<Welcome />}/>
                <Route path="angles" element={<Angles />}/>
                <Route path="atmosphere" element={<Atmosphere />}/>
                <Route path="cube" element={<Cube />}/>
                <Route path="galaxy" element={<Galaxy />}/>
                <Route path="grid" element={<Grid />}/>
                <Route path="labels" element={<Labels />}/>
                <Route path="loader" element={<Loader />}/>
                <Route path="measure" element={<Measure />}/>
                <Route path="orbit" element={<Orbit />}/>
                <Route path="picking" element={<Picking />}/>
                <Route path="saturn-earth" element={<SaturnEarth />}/>
                <Route path="stars" element={<Stars />}/>
                <Route path="star" element={<Star />}/>
                <Route path="asterisms" element={<Asterisms />}/>
                <Route path="planet" element={<Planet />}/>
                {/*
  <Route path="map" element={ <Map/> }/>
  <Route path="sphere-map" element={ <SphereMap/> }/>
  <Route path="wind" element={ <Wind/> }/>*/}
              </Routes>
            </td>
          </tr>
        </tbody>
      </table>
    </>);
}
