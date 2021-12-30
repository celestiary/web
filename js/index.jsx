import React from 'react'
import { render } from 'react-dom'
import { BrowserRouter } from 'react-router-dom'
import Routed from './Routed'


render(
  <BrowserRouter>
    <Routed/>
  </BrowserRouter>, document.getElementById('root'))
