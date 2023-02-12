import React from 'react'
import {useLocation} from 'react-router-dom'
import AboutButton from './About'
import Celestiary from './Celestiary'
import HelpButton from './Help'
import TimePanel from './TimePanel'
import {elt, setTitleFromLocation} from './utils'
import './index.css'


/**
 * @returns {React.Component}
 */
export default function App() {
  const location = useLocation()
  React.useEffect(() => {
    setTitleFromLocation(location)
  }, [location])

  const [celestiary, setCelestiary] = React.useState(null)
  const [timeStr, setTimeStr] = React.useState('')
  React.useEffect(() => {
    setCelestiary(new Celestiary(elt('scene-id'), elt('nav-id'), setTimeStr))
  }, [])

  return (
    <>
      <div id="scene-id"/>
      <div id="nav-id" className="panel">Welcome to Celestiary!  Loading...</div>
      <div id="top-right" className="panel">
        {celestiary && <TimePanel time={celestiary.time} timeStr={timeStr}/>}
        <div id="text-buttons">
          {celestiary && <HelpButton keys={celestiary.keys} />}
          <AboutButton/>
        </div>
      </div>
      <h1 id="target-id">Hello</h1>
    </>)
}
