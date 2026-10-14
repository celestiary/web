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
