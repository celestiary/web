import React, {Fragment} from 'react'
import {createRoot} from 'react-dom/client'
import Style from './Style'
import Routed from './Routed'
import pkgInfo from '../package.json'


// Enable esbuild hot-reload in dev builds. The /esbuild SSE endpoint is only
// present when running `yarn serve` (esbuild dev server). Guarded by __DEV__
// (build-time flag) to prevent connection attempts in production and PR previews.
if (__DEV__) {
  const esBuildEs = new EventSource('esbuild')
  esBuildEs.addEventListener('open', () => console.warn('Hot reload active (/esbuild connected)'))
  esBuildEs.addEventListener('change', () => location.reload())
  esBuildEs.addEventListener('error', () => esBuildEs.close())
}


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
