import React, {ReactElement, useEffect, useState} from 'react'
import {Link, useLocation} from 'wouter'
import Dialog from './Dialog'
import useStore from '../store/useStore'
import Typography from '@mui/material/Typography'
import pkgInfo from '../../package.json'


/** @returns {ReactElement} */
export default function About() {
  const starsCatalog = useStore((state) => state.starsCatalog)
  // TODO(pablo): hardcoded for now, as asterisms are lazy load when used
  // const asterismsCatalog = useStore((state) => state.asterismsCatalog)
  const [isOpen, setIsOpen] = useState(false)
  const [location] = useLocation()
  useEffect(() => setIsOpen(location === '/about'), [location])
  return (
    <Dialog title='Celestiary' isOpen={isOpen} setIsOpen={setIsOpen} onCloseHref='~/'>
      <p>A cosmological simulator</p>

      <Typography variant='h4'>Features</Typography>
      <ul>
        <li>9 planets, 20 moons. Accurate major planet orbits</li>
        <li>{Number(starsCatalog.numStars).toLocaleString()} stars,&nbsp;
          {Number(starsCatalog.hipByName.size).toLocaleString()} names</li>
        <li>89 constellations{/* Number(asterismsCatalog.numAsterisms).toLocaleString() */}</li>
        <li>Time controls for rate and direction of time</li>
        <li>Kinda works on mobile! :)</li>
      </ul>
      <Typography variant='h4'>News</Typography>
      <p>The current version is {pkgInfo.version}.</p>
      <ul>
        <li>2024 Feb 18 - Use highly accurate <Link href='~/guide/vsop'>VSOP</Link> orbits
        for major planets.</li>
        <li>2021 Jan 25 - Works in Safari 13.1.2+ on OSX, maybe earlier.
          Now all major browsers tested except IE.</li>
      </ul>
      <Typography variant='h4'>Learn more</Typography>
      <ul>
        <li><Link to='/guide'>Developer guide</Link></li>
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
    </Dialog>
  )
}
