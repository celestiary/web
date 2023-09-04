import React, {Suspense} from 'react'
import {Routes, Route} from 'react-router-dom'


const App = React.lazy(() => import('./App'))
const Guide = React.lazy(() => import('./guide/Guide'))


/** @returns {React.Component} */
export default function Routed() {
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
    </Routes>)
}
