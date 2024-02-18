import React from 'react'
import {Link} from 'react-router-dom'


/** @returns {React.ReactElement} */
export default function About() {
  const [open, setOpen] = React.useState(false)
  const toggleOpen = () => {
    setOpen(!open)
  }
  return (
    <>
      <button onClick={toggleOpen} className='textButton'>About</button>
      {open && <AboutDialog openToggle={toggleOpen}/>}
    </>)
}


/** @returns {React.ReactElement} */
function AboutDialog({openToggle}) {
  return (
    <div className='dialog'>
      <button onClick={openToggle}>X</button>
      <h1>About</h1>
      Celestiary is a cosmological simulator.

      <h2>News</h2>
      <ul>
        <li>2021 Dec 30 - Introduce esbuild with code splitting.  Use react
          and react-router to improve code structure and prepare for better
          permalinks.</li>
        <li>2021 Jan 25 - Works in Safari 13.1.2+ on OSX, maybe earlier.
          Now all major browsers tested except IE.</li>
      </ul>

      <h2>Features</h2>
      <ul>
        <li>Keplerian orbits (6 orbital elements)</li>
        <li>Time controls, to alter rate and direction of time</li>
        <li>Star colors based on surface temperatures</li>
        <li>Star surface dynamics simulation (Perlin noise in black-body spectra)</li>
        <li>9 planets, 20 moons</li>
        <li>Permanent links for scene locations</li>
        <li>Even kinda works on mobile! :)</li>
      </ul>
      <h2>Datasets</h2>
      <ul>
        <li>~100,000 stars</li>
        <li>~3k star names</li>
        <li>~80 Asterisms/constellations</li>
      </ul>
      <h2>Learn more</h2>
      <ul>
        <li><Link to='/guide'>Software development guide</Link></li>
        <li>
          <a
            href='https://github.com/pablo-mayrgundter/celestiary'
            target='_blank'
            rel='noreferrer'
          >
            Source code (GitHub)
          </a>
        </li>
      </ul>
    </div>)
}
