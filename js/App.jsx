import React, {useEffect, useRef, useState} from 'react'
import {Link, Route, useLocation} from 'wouter'
import About from './About'
import Celestiary from './Celestiary'
import Help from './Help'
import TimePanel from './TimePanel'
import {setTitleFromLocation} from './utils'
import './index.css'


/** @returns {React.ReactElement} */
export default function App() {
  const [celestiary, setCelestiary] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [timeStr, setTimeStr] = useState('')

  const sceneRef = useRef(null)
  const navRef = useRef(null)

  const [location] = useLocation()


  useEffect(() => setTitleFromLocation(location), [location])


  useEffect(() => {
    setCelestiary(new Celestiary(sceneRef.current, navRef.current, setTimeStr, setIsPaused))
  }, [])


  return (
    <>
      <div ref={sceneRef} id='scene-id'/>
      <div ref={navRef} id='nav-id' className='panel'>Welcome to Celestiary!  Loading...</div>
      <div id='top-right' className='panel'>
        {celestiary && <TimePanel time={celestiary.time} timeStr={timeStr} isPaused={isPaused}/>}
        <div id='text-buttons'>
          {celestiary &&
           <>
             <Link href='/help'>Help</Link>
             <Route path='/help'>
               <Help keys={celestiary.keys}/>
             </Route>
           </>
          }
          &nbsp;|&nbsp;
          <Link href='/about'>About</Link>
          <Route path='/about'>
            <About/>
          </Route>
        </div>
      </div>
      <h1 id='target-id'> </h1>
    </>)
}
