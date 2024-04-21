import React, {Fragment} from 'react'
import {createRoot} from 'react-dom/client'
import Style from './Style'
import Routed from './Routed'
import pkgInfo from '../package.json'


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
