import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'


/**
 * @param {Function} callback Passed vsop87c function when it's ready
 */
export function loadVsop87c(onLoad) {
  vsop87cLoader.then((vsop87c) => {
    onLoad(vsop87c)
  })
}
