import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {Route, useLocation} from 'wouter'
import {useHashLocation} from 'wouter/use-hash-location'
import Box from '@mui/material/Box'
import ScopedCssBaseline from '@mui/material/ScopedCssBaseline'
import Stack from '@mui/material/Stack'
import Celestiary from './Celestiary'
import useStore from './store/useStore'
import About from './ui/About'
import Settings from './ui/Settings'
import TimePanel from './ui/TimePanel'
import TooltipToggleButton from './ui/TooltipToggleButton'
import {setTitleFromLocation} from './utils'
import SettingsIcon from '@mui/icons-material/Settings'
import StarsIcon from '@mui/icons-material/AutoAwesome'
import StarSelectIcon from '@mui/icons-material/SavedSearch'
import './index.css'


/** @returns {ReactElement} */
export default function App() {
  const toggleIsStarsSelectActive = useStore((state) => state.toggleIsStarsSelectActive)
  const [celestiary, setCelestiary] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [timeStr, setTimeStr] = useState('')

  const sceneRef = useRef(null)
  const navRef = useRef(null)

  const [location, navigate] = useLocation()
  const [hashLocation] = useHashLocation()

  useEffect(() => setTitleFromLocation(location), [location])
  useEffect(() => {
    console.log('Celestiary, hashLocation:', hashLocation)
    const c = new Celestiary(useStore, sceneRef.current, navRef.current, setTimeStr, setIsPaused)
    setCelestiary(c)
    c.keys.map('?', () => navigate('/settings'), 'Show keyboard shortcuts')
  }, [])

  return (
    <>
      <ScopedCssBaseline/>
      <div ref={sceneRef} id='scene-id'/>
      <div ref={navRef} id='nav-id' className='panel'>Welcome to Celestiary!  Loading...</div>
      <Stack id='top-right' className='panel' direction='column' justifyContent='flex-start' alignItems='flex-end'>
        {celestiary && <TimePanel time={celestiary.time} timeStr={timeStr} isPaused={isPaused} setIsPaused={setIsPaused}/>}
        <div id='text-buttons'>
          {celestiary &&
            <Box sx={{position: 'fixed', bottom: 0, left: 0, m: '1em'}}>
              <TooltipToggleButton tip='About' icon={<StarsIcon/>} onClick={() => navigate('/about')}/>
              <Route path='/about'>
                <About/>
              </Route>
              <TooltipToggleButton tip='Settings' icon={<SettingsIcon/>} onClick={() => navigate('/settings')}/>
              <Route path='/settings'>
                <Settings keys={celestiary.keys}/>
              </Route>
            </Box>
          }
        </div>
        <TooltipToggleButton tip='select' icon={<StarSelectIcon/>} onClick={toggleIsStarsSelectActive}/>
      </Stack>
      <h1 id='target-id'> </h1>
    </>)
}
