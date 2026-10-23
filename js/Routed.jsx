import React, {ReactElement, Suspense, lazy, useEffect, useState} from 'react'
import {Route, Router, Switch, useLocation} from 'wouter'
import {staleRoute} from './staleBuild'


// Base path the site is deployed under (e.g. '' at celestiary.org's root,
// '/web/pr-preview/pr-42' for PR previews).
// Derived from the <base href> tag injected at build time so the same
// bundle works under any subpath.
const BASE = new URL(document.baseURI).pathname.replace(/\/$/, '')

// No fallback text: the page's own loading text (public/index.html) shows
// until the scene, or the guide, is in.
//
// Made once, here, not in Routed: a lazy() made in a render is a new
// component type each time Routed renders (on every path change, such as
// the Settings and About dialogs' /settings and /about), and a new lazy
// type suspends on its first render even when its module is loaded.  Its
// Suspense then hid the whole app (display: none !important on every
// element) until the import's promise settled: a blank frame or several,
// the flicker on opening a dialog.
//
// A route's chunk that a deploy has deleted (a cached index.js asking for
// the last build's) goes to the page's stale-build recovery
// (js/staleBuild.js).
const App = lazy(() => import('./App').catch(staleRoute))
const Guide = lazy(() => import('./guide/Guide').catch(staleRoute))


/** @returns {ReactElement} */
export default function Routed() {
  const [app, setApp] = useState(null)
  const [guide, setGuide] = useState(null)
  const [, navigate] = useLocation()

  useEffect(() => {
    const referrer = document.referrer
    if (referrer) {
      const path = new URL(document.referrer).pathname
      // After the 404 bounce the referrer is the page itself, which the
      // address bar already holds with its hash (/guide/star#Sol):
      // navigating to the bare path would drop the hash.
      if (path.length > 1 && path !== window.location.pathname) {
        navigate(path)
      }
    }
  }, [navigate])

  return (
    <Router base={BASE}>
      <Switch>
        <Route path='/guide' nest>
          <Suspense fallback={null}>
            <Guide/>
          </Suspense>
        </Route>
        <Route path='/' nest>
          <Suspense fallback={null}>
            <App/>
          </Suspense>
        </Route>
      </Switch>
    </Router>
  )
}

// import {useHashLocation} from 'wouter/use-hash-location'
//        <Router hook={useHashLocation}>
//        </Router>
