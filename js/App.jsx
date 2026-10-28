import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {Route, useLocation} from 'wouter'
import {useHashLocation} from 'wouter/use-hash-location'
import Box from '@mui/material/Box'
import ScopedCssBaseline from '@mui/material/ScopedCssBaseline'
import Stack from '@mui/material/Stack'
import Celestiary from './Celestiary'
import useIsMobile from './useIsMobile'
import useStore from './store/useStore'
import About from './ui/About'
import ARDebugHUD from './ui/ARDebugHUD'
import DragModeToggle from './ui/DragModeToggle'
import ExposureReadout from './ui/ExposureReadout'
import Homepage from './ui/Homepage'
import LayersButton from './ui/LayersButton'
import NewsTour from './ui/NewsTour'
import PhoneDock from './ui/PhoneDock'
import SearchBar from './ui/SearchBar'
import Settings from './ui/Settings'
import TimePanel from './ui/TimePanel'
import TooltipIconButton from './ui/TooltipIconButton'
import TooltipToggleButton from './ui/TooltipToggleButton'
import WidgetsDrawer from './ui/WidgetsDrawer'
import {capitalize} from './utils'
import SettingsIcon from '@mui/icons-material/Settings'
import StarsIcon from '@mui/icons-material/AutoAwesome'
import WidgetsIcon from '@mui/icons-material/WidgetsOutlined'
import './index.css'


/** @returns {ReactElement} */
export default function App() {
  const committedPath = useStore((s) => s.committedPath)
  const committedStar = useStore((s) => s.committedStar)
  const committedTarget = useStore((s) => s.committedTarget)
  const dispatchWidgets = useStore((s) => s.dispatchWidgets)
  const homePhase = useStore((s) => s.homePhase)
  const newsTour = useStore((s) => s.newsTour)
  const [celestiary, setCelestiary] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [timeStr, setTimeStr] = useState('')
  const isMobile = useIsMobile()
  // On a phone the floating controls give way to the dock (PhoneDock).
  const floating = celestiary && !isMobile

  const sceneRef = useRef(null)
  const navInfoRef = useRef(null)

  const [location, navigate] = useLocation()
  const [hashLocation] = useHashLocation()

  // Page title tracks the committed target.  Leaf-first so the active body
  // is visible even in truncated tab titles.
  useEffect(() => {
    let leaf = null
    if (homePhase !== 'hidden') {
      // The homepage: its tour's targets aren't the page's.
      leaf = null
    } else if (location === '/guide') {
      leaf = 'Guide'
    } else if (['place', 'asterism', 'satellite'].includes(committedTarget?.kind)) {
      leaf = committedTarget.name
    } else if (committedStar && committedStar.displayName) {
      leaf = committedStar.displayName
    } else if (committedPath.length > 0) {
      // A body's own label where it has one (`2026 ED138`).
      const name = committedPath[committedPath.length - 1]
      leaf = celestiary?.scene?.objects?.[name]?.props?.label ?? capitalize(name)
    }
    document.title = leaf ? `${leaf} — Celestiary` : 'Celestiary'
  }, [location, committedPath, committedStar, committedTarget, homePhase, celestiary])
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
        {celestiary && homePhase === 'hidden' && <SearchBar celestiary={celestiary}/>}
        <div ref={navInfoRef} id='nav-info-id'>Welcome to Celestiary!  Loading...</div>
      </div>
      <Stack id='top-right' className='panel' direction='column' justifyContent='flex-start' alignItems='flex-end'>
        {floating &&
          <TooltipIconButton tip='Widgets' onClick={() => dispatchWidgets({type: 'toggle'})} icon={<WidgetsIcon/>}/>}
        {floating && <TimePanel time={celestiary.time} timeStr={timeStr} isPaused={isPaused} setIsPaused={setIsPaused}/>}
        {floating && <DragModeToggle/>}
        {floating && <LayersButton/>}
        {celestiary && <ARDebugHUD celestiary={celestiary}/>}
        <div id='text-buttons'>
          {floating &&
            <Box sx={{position: 'fixed', bottom: 0, left: 0, m: '1em'}}>
              <TooltipToggleButton tip='Settings' icon={<SettingsIcon/>} onClick={() => navigate('/settings')}/>
              <TooltipToggleButton tip='About' icon={<StarsIcon/>} onClick={() => navigate('/about')}/>
            </Box>
          }
        </div>
      </Stack>
      {celestiary &&
        <Route path='/settings'>
          <Settings keys={celestiary.keys}/>
        </Route>}
      {celestiary &&
        <Route path='/about'>
          <About/>
        </Route>}
      {celestiary && isMobile && homePhase === 'hidden' &&
        <PhoneDock celestiary={celestiary} timeStr={timeStr} isPaused={isPaused} setIsPaused={setIsPaused}/>}
      {celestiary && <ExposureReadout celestiary={celestiary}/>}
      {celestiary && <WidgetsDrawer celestiary={celestiary}/>}
      {celestiary && homePhase !== 'hidden' && <Homepage celestiary={celestiary} phase={homePhase}/>}
      {celestiary && newsTour && <NewsTour celestiary={celestiary} tour={newsTour}/>}
    </>)
}
