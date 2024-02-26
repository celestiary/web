import React, {Fragment} from 'react'
import {createRoot} from 'react-dom/client'
import Style from './Style'
import Routed from './Routed'


/** @returns {Fragment} */
function Root({children}) {
  return (
    <Style>
      <Routed/>
    </Style>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<Root/>)
