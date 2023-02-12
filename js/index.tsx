import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import Routed from './Routed'


const root = createRoot(document.getElementById('root'))
root.render(
    <BrowserRouter>
      <Routed/>
    </BrowserRouter>)
