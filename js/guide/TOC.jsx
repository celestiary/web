import {ReactElement} from 'react'
import {Link} from 'wouter'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'


/** @returns {ReactElement} */
export default function TOC() {
  return (
    <Box sx={{m: '1em'}}>
      <Typography variant='h4'>Guide</Typography>
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
                <li><Link to='/sphere'>Sphere</Link></li>
                <li><Link to='/cube'>Lit Cube</Link></li>
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
      </ol>
    </Box>
  )
}


/* <li>Earth:
          <ul>
          <li><Link to='/map'>Map</Link></li>
          <li><Link to='/sphere-map'>Sphere map</Link></li>
          <li><Link to='/wind'>Wind map</Link></li>
          </ul>
          </li>
          <li><Link to='/saturn-earth'>Earth, Saturn's moon</Link></li>
<Route path='/map'><Map/></Route>
<Route path='/sphere-map'><SphereMap/></Route>
<Route path='/wind'><Wind/></Route>
*/
