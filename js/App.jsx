import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {Route, useLocation} from 'wouter'
import {useHashLocation} from 'wouter/use-hash-location'
import Box from '@mui/material/Box'
import ScopedCssBaseline from '@mui/material/ScopedCssBaseline'
import Stack from '@mui/material/Stack'
import Celestiary from './Celestiary'
import useStore from './store/useStore'
import About from './ui/About'
import SearchBar from './ui/SearchBar'
import Settings from './ui/Settings'
import TimePanel from './ui/TimePanel'
import TooltipToggleButton from './ui/TooltipToggleButton'
import {capitalize} from './utils'
import SettingsIcon from '@mui/icons-material/Settings'
import StarsIcon from '@mui/icons-material/AutoAwesome'
import './index.css'


/** @returns {ReactElement} */
export default function App() {
  const committedPath = useStore((s) => s.committedPath)
  const committedStar = useStore((s) => s.committedStar)
  const [celestiary, setCelestiary] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [timeStr, setTimeStr] = useState('')

  const sceneRef = useRef(null)
  const navInfoRef = useRef(null)

  const [location, navigate] = useLocation()
  const [hashLocation] = useHashLocation()

  // Page title tracks the committed target.  Leaf-first so the active body
  // is visible even in truncated tab titles.
  useEffect(() => {
    let leaf = null
    if (location === '/guide') {
      leaf = 'Guide'
    } else if (committedStar && committedStar.displayName) {
      leaf = committedStar.displayName
    } else if (committedPath.length > 0) {
      leaf = capitalize(committedPath[committedPath.length - 1])
    }
    document.title = leaf ? `${leaf} — Celestiary` : 'Celestiary'
  }, [location, committedPath, committedStar])
  useEffect(() => {
    const c = new Celestiary(useStore, sceneRef.current, navInfoRef.current, setTimeStr, setIsPaused)
    setCelestiary(c)
    c.keys.map('?', () => navigate('/settings'), 'Show keyboard shortcuts')
  }, [])

  return (
    <>
      <ScopedCssBaseline/>
      <div ref={sceneRef} id='scene-id'/>
      <div id='nav-id' className='panel'>
        {celestiary && <SearchBar celestiary={celestiary}/>}
        <div ref={navInfoRef} id='nav-info-id'>Welcome to Celestiary!  Loading...</div>
      </div>
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
      </Stack>
    </>)
}
