import React, {ReactElement, Suspense, lazy, useEffect, useState} from 'react'
import {Route, Router, Switch, useLocation} from 'wouter'


/** @returns {ReactElement} */
export default function Routed() {
  const [app, setApp] = useState(null)
  const [guide, setGuide] = useState(null)
  const [, navigate] = useLocation()

  useEffect(() => {
    const referrer = document.referrer
    console.log('Routed.jsx: referer', referrer)
    if (referrer) {
      const path = new URL(document.referrer).pathname
      if (path.length > 1) {
        navigate(path)
      }
    }
  }, [navigate])

  const App = lazy(() => import('./App'))
  const Guide = lazy(() => import('./guide/Guide'))

  return (
    <Router>
      <Switch>
        <Route path='/guide' nest>
          <Suspense fallback={<>Loading...</>}>
            <Guide/>
          </Suspense>
        </Route>
        <Route path='/' nest>
          <Suspense fallback={<>Loading...</>}>
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
