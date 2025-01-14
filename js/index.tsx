import React, {Fragment} from 'react'
import {createRoot} from 'react-dom/client'
import Style from './Style'
import Routed from './Routed'
import pkgInfo from '../package.json'


// Enable esbuild hot-reload model
if (process.env.NODE_ENV === 'development') {
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
  console.log('index.tsx: developer mode hot reloading is enabled')
}


/** @returns {Fragment} */
function Root({children}) {
  console.log(`Celestiary version: ${pkgInfo.version}`)
  return (
    <Style>
      <Routed/>
    </Style>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<Root/>)
