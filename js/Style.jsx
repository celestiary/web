import React, {Fragment, useMemo} from 'react'
import {createTheme, ThemeProvider} from '@mui/material/styles'


/** @returns {Fragment} */
export default function Style({children}) {
  const theme = useMemo(() => createTheme({
    components: {
      MuiButtonBase: {
        styleOverrides: {
          root: {
            borderRadius: '50%',
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderRadius: '50%',
            border: 'none',
          },
        },
      },
    },
    palette: dark,
    typography: {
      // The page's typeface (index.css --font-ui), for MUI's components too.
      fontFamily: UI_FONT,
      h1: {fontSize: '1.6rem'},
      h2: {fontSize: '1.5rem'},
      h3: {fontSize: '1.4rem'},
      h4: {fontSize: '1.3rem'},
      h5: {fontSize: '1.2rem'},
      h6: {fontSize: '1.1rem'},
    },
  }), [])

  return (
    <Fragment>
      <ThemeProvider theme={theme}>
        {children}
      </ThemeProvider>
    </Fragment>
  )
}


// As index.css --font-ui: Inter (public/index.html loads it), else the system's sans.
const UI_FONT = '\'Inter\', system-ui, -apple-system, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif'


// MUI's palette, from the theme (js/theme.js; design/UI.md, "The theme").
// Written here by `yarn theme`, not imported: this module is in the page's
// entry, and importing the theme from it split the theme into a file of its
// own, a request more on every load.  tools/theme/css.test.js checks it.
// The page is dark only: the light palette and its toggle were never used.
// theme: begin.  Written by `yarn theme` from js/theme.js; edit there.
const uiColors = {
  accent: '#869fdb',
  inkBright: '#ffffff',
}
// theme: end
const dark = {
  mode: 'dark',
  primary: {
    main: uiColors.accent,
    // Placeholders from the start, which MUI uses for a contained button's
    // hover (dark) and more: kept as they are in the theme's refactor, which
    // changes nothing on screen; to be taken from the theme (or left for MUI
    // to derive from main) in the colour corrections that follow.
    light: '#0f0',
    dark: '#00f',
    contrastText: uiColors.inkBright,
  },
}
