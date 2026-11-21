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


// Dark only (the light palette and its toggle were never used).  The
// palette's colours are the theme's, set by each route (ui/Palette.jsx).
const dark = {
  mode: 'dark',
}
