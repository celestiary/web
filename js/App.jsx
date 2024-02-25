import React, {useEffect, useRef, useState} from 'react'
import {Route, useLocation} from 'wouter'
import Box from '@mui/material/Box'
import Celestiary from './Celestiary'
import About from './ui/About'
import Help from './ui/Help'
import TimePanel from './ui/TimePanel'
import TooltipIconButton from './ui/TooltipIconButton'
import {setTitleFromLocation} from './utils'
import HelpIcon from '@mui/icons-material/HelpOutline'
import StarsIcon from '@mui/icons-material/AutoAwesome'
import './index.css'


/** @returns {React.ReactElement} */
export default function App() {
  const [celestiary, setCelestiary] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [timeStr, setTimeStr] = useState('')

  const sceneRef = useRef(null)
  const navRef = useRef(null)

  const [location, navigate] = useLocation()


  useEffect(() => setTitleFromLocation(location), [location])


  useEffect(() => {
    setCelestiary(new Celestiary(sceneRef.current, navRef.current, setTimeStr, setIsPaused))
  }, [])


  return (
    <>
      <div ref={sceneRef} id='scene-id'/>
      <div ref={navRef} id='nav-id' className='panel'>Welcome to Celestiary!  Loading...</div>
      <div id='top-right' className='panel'>
        {celestiary && <TimePanel time={celestiary.time} timeStr={timeStr} isPaused={isPaused} setIsPaused={setIsPaused}/>}
        <div id='text-buttons'>
          {celestiary &&
           <Box sx={{position: 'fixed', bottom: 0, right: 0, m: '1em'}}>
             <TooltipIconButton tip='Help' onClick={() => navigate('/help')} icon={<HelpIcon/>}/>
             <Route path='/help'>
               <Help keys={celestiary.keys}/>
             </Route>
           </Box>
          }
          <Box sx={{position: 'fixed', bottom: 0, left: 0, m: '1em'}}>
            <TooltipIconButton tip='About' onClick={() => navigate('/about')} icon={<StarsIcon/>}/>
            <Route path='/about'>
              <About/>
            </Route>
          </Box>
        </div>
      </div>
      <h1 id='target-id'> </h1>
    </>)
}
