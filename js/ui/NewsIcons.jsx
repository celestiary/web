import React from 'react'


/**
 * The What's new panel's and the changelog tour's icons: Material's glyphs
 * as plain SVG, 24 units square, in the text's colour.  Not MUI's icon
 * components, so these render without its styling engine (their tests render
 * to markup under whatever globals the other test files have set).
 *
 * @param {string} d The path
 * @param {number} size px
 * @returns {Function} A component
 */
function icon(d, size = 24) {
  return function Icon() {
    return (
      <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true' focusable='false'>
        <path d={d}/>
      </svg>
    )
  }
}


export const CloseIcon = icon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z')
export const PauseIcon = icon('M6 19h4V5H6zm8-14v14h4V5z')
export const PlayIcon = icon('M8 5v14l11-7z')
export const SkipNextIcon = icon('m6 18 8.5-6L6 6zM16 6v12h2V6z')
export const SkipPreviousIcon = icon('M6 6h2v12H6zm3.5 6 8.5 6V6z')
// Small, beside text.
export const SmallCloseIcon = icon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z', 20)
export const SmallPlayIcon = icon('M8 5v14l11-7z', 20)
// The platforms' marks, monochrome (simple-icons' paths, 24 units), beside an entry's links.
export const XIcon = icon('M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z', 16)
export const FacebookIcon = icon('M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z', 16)
