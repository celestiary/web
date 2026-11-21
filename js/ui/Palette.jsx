import React, {ReactElement} from 'react'
import {ThemeProvider} from '@mui/material/styles'
import {uiColors} from '../theme.js'


/**
 * MUI's palette from the theme (js/theme.js; design/UI.md, "The theme"),
 * nested inside Style's ThemeProvider by each route (App, the guide).  Not
 * in Style.jsx: that is in the page's entry, and importing the theme from
 * it split the theme into a file of its own, a request more on every load.
 *
 * @param {object} outer Style's theme
 * @returns {object} It with the theme's primary
 */
function withPalette(outer) {
  return {
    ...outer,
    palette: {
      ...outer.palette,
      primary: {
        main: uiColors.accent,
        // Placeholders from the start, which MUI uses for a contained
        // button's hover (dark) and more: kept as they are in the theme's
        // refactor, which changes nothing on screen; to be taken from the
        // theme (or left for MUI to derive from main) in the colour
        // corrections that follow.
        light: '#0f0',
        dark: '#00f',
        contrastText: uiColors.inkBright,
      },
    },
  }
}


/** @returns {ReactElement} */
export default function Palette({children}) {
  return <ThemeProvider theme={withPalette}>{children}</ThemeProvider>
}
