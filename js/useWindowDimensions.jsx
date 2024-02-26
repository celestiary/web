import {useEffect, useState} from 'react'


/** @returns {{width: number, height: number}} */
export default function useWindowDimensions() {
  const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions())


  useEffect(() => {
    /** Handle resize */
    function handleResize() {
      setWindowDimensions(getWindowDimensions())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])


  return windowDimensions
}


/** @returns {{width: number, height: number}} */
function getWindowDimensions() {
  const {innerWidth: width, innerHeight: height} = window
  return {
    width,
    height,
  }
}
