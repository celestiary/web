import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'


vsop87cLoader.then((vsop87c) => {
  // Get an object with the (x,y,z) coordinates of each planet.
  const coords = vsop87c(2451545)
  console.log('VSOP COORDS:', coords)
})
