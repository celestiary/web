import React, {ReactElement, useEffect, useState} from 'react'
import {Route, Link, useLocation} from 'wouter'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import TooltipIconButton from '../ui/TooltipIconButton'
import {styled} from '@mui/material/styles'
import {setTitleFromLocation} from '../utils'
import useIsMobile from '../useIsMobile'
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
import TOC from './TOC'
import Picking from './Picking'
import Planet from './Planet'
import SaturnEarth from './SaturnEarth'
import Star from './Star'
import Stars from './Stars'
import VSOP from './VSOP'
import Welcome from './Welcome'
import MenuIcon from '@mui/icons-material/Menu'
// import Map from './Map'
// import SphereMap from './SphereMap'
// import Wind from './Wind'
// import StarsPicking from './StarsPicking'
// import Asteroids from './Asteroids'


/** @returns {ReactElement} */
export default function Guide() {
  const [isOpen, setIsOpen] = useState(false)
  const [location] = useLocation()
  const isMobile = useIsMobile()

  useEffect(() => {
    setTitleFromLocation(location, 'Guide')
  }, [location])

  document.body.style.overflow = 'inherit'

  return (
    <Box
      sx={{
        width: '100%',
        '& h1': {
          display: 'inline-block',
        },
        '& .MuiIconButton-root': {
          margin: '0 0.5em 0.5em 0.5em',
        },
        '& div, & p, & table, & ul': {
          margin: '1em',
        },
      }}>
      <Drawer
        anchor={isMobile ? 'bottom' : 'left'}
        open={isOpen}
        onClose={() => setIsOpen(false)}
        ModalProps={{
          keepMounted: true, // Better open performance on mobile
        }}
      >
        <TOC/>
      </Drawer>
      <Box>
        <TooltipIconButton
          tip='Sections'
          icon={<MenuIcon/>}
          onClick={() => setIsOpen(!isOpen)}
        />
        <Route path='/'><Welcome/></Route>
        <Route path='/angles'><Angles/></Route>
        <Route path='/asterisms'><Asterisms/></Route>
        <Route path='/atmosphere'><Atmosphere/></Route>
        <Route path='/cube'><Cube/></Route>
        <Route path='/galaxy' nest><Galaxy/></Route>
        <Route path='/grid'><Grid/></Route>
        <Route path='/labels'><Labels/></Route>
        <Route path='/loader'><Loader/></Route>
        <Route path='/measure'><Measure/></Route>
        <Route path='/orbit'><Orbit/></Route>
        <Route path='/picking'><Picking/></Route>
        <Route path='/planet'><Planet/></Route>
        <Route path='/sphere'><Sphere/></Route>
        <Route path='/star'><Star/></Route>
        <Route path='/stars'><Stars/></Route>
        <Route path='/vsop'><VSOP/></Route>
        <Route path='/vsop/:day'><VSOP/></Route>
      </Box>
    </Box>
  )
}
