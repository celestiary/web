import React, {Suspense, useEffect} from 'react'
import {Routes, Route, useNavigate} from 'react-router-dom'
const App = React.lazy(() => import('./App'))
const Guide = React.lazy(() => import('./guide/Guide'))


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
        </Suspense>}/>
      <Route path="/guide/*" element={
        <Suspense fallback={<div>Loading...</div>}>
          <Guide/>
        </Suspense>}/>
    </Routes>)
}
