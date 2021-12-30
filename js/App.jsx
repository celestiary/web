import React from 'react'
import AboutButton from './About'
import Celestiary from './Celestiary'
import HelpButton from './Help'
import TimePanel from './TimePanel'
import * as collapsor from './collapsor'
import { elt } from './utils'
import './index.css'


export default function App() {
  const [celestiary, setCelestiary] = React.useState(null);
  const [timeStr, setTimeStr] = React.useState('bar');
  const [showAbout, setShowAbout] = React.useState(false);
  React.useEffect(() => {
    setCelestiary(new Celestiary(elt('scene-id'), elt('nav-id'), setTimeStr));
  }, []);
  return (
    <>
      <div id="scene-id"/>
      <div id="nav-id" className="panel">Welcome to Celestiary!  Loading...</div>
      <div id="top-right" className="panel">
        {celestiary && <TimePanel time={celestiary.time} timeStr={timeStr}/>}
        {celestiary && <HelpButton keys={celestiary.keys} />}
        <AboutButton/>
      </div>
      <h1 id="target-id"></h1>
    </>);
};
