import React, {Suspense, useEffect} from 'react'
import {Routes, Route, useNavigate} from 'react-router-dom'


const App = React.lazy(() => import('./App'))
const Guide = React.lazy(() => import('./guide/Guide'))
const VSOP = React.lazy(() => import('./vsop/VSOP'))


/** @returns {React.ReactElement} */
export default function Routed() {
  const navigate = useNavigate()

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
    <Routes>
      <Route path="/*" element={
        <Suspense fallback={<div>Loading...</div>}>
          <App/>
        </Suspense>}
      />
      <Route path="/guide/*" element={
        <Suspense fallback={<div>Loading...</div>}>
          <Guide/>
        </Suspense>}
      />
      <Route path="/vsop">
        <Route
          index
          element={<Suspense fallback={<div>Loading...</div>}><VSOP isIndex={true}/></Suspense>}
        />
        <Route
          path=":day"
          element={<Suspense fallback={<div>Loading...</div>}><VSOP/></Suspense>}
        />
      </Route>
    </Routes>)
}
