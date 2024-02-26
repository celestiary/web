import React, {Suspense, useEffect} from 'react'
import {Route, Router, Switch, useLocation} from 'wouter'


const App = React.lazy(() => import('./App'))
const Guide = React.lazy(() => import('./guide/Guide'))


/** @returns {React.ReactElement} */
export default function Routed() {
  const [, navigate] = useLocation()

  useEffect(() => {
    const referrer = document.referrer
    if (referrer) {
      const path = new URL(document.referrer).pathname
      if (path.length > 1) {
        navigate(path)
      }
    }
  }, [navigate])

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
