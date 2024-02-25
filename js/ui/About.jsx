import React, {useEffect, useState} from 'react'
import {Link, useLocation} from 'wouter'
import Dialog from './Dialog'
import Typography from '@mui/material/Typography'


/** @returns {React.ReactElement} */
export default function About() {
  const [isOpen, setIsOpen] = useState(false)
  const [location] = useLocation()
  useEffect(() => setIsOpen(location === '/about'), [location])
  return (
    <Dialog title='About' isOpen={isOpen} setIsOpen={setIsOpen} onCloseHref='~/'>
      <p>Celestiary is a cosmological simulator</p>

      <Typography variant='h3'>Features</Typography>
      <ul>
        <li>VSOP Orbits for major planets, pseudo-keplerian orbits for moons (6 orbital elements)</li>
        <li>Time controls, to alter rate and direction of time</li>
        <li>Star colors based on surface temperatures</li>
        <li>Star surface dynamics simulation (Perlin noise in black-body spectra)</li>
        <li>9 planets, 20 moons</li>
        <li>Permanent links for scene locations</li>
        <li>Even kinda works on mobile! :)</li>
      </ul>
      <Typography variant='h3'>Datasets</Typography>
      <ul>
        <li>~100,000 stars</li>
        <li>~3k star names</li>
        <li>~80 Asterisms/constellations</li>
      </ul>
      <Typography variant='h3'>News</Typography>
      <ul>
        <li>2024 Feb 18 - Use highly accurate <Link href='~/guide/vsop'>VSOP</Link> orbits
        for major planets.</li>
        <li>2021 Jan 25 - Works in Safari 13.1.2+ on OSX, maybe earlier.
          Now all major browsers tested except IE.</li>
      </ul>
      <Typography variant='h3'>Learn more</Typography>
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
    </Dialog>
  )
}
