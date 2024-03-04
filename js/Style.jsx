import React, {Fragment, createContext, useMemo, useState} from 'react'
import {createTheme, ThemeProvider} from '@mui/material/styles'


/** @returns {Fragment} */
export default function Style({children}) {
  const [mode, setMode] = useState('dark')
  const colorMode = useMemo(() => ({toggleColorMode: () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'))
  }}), [])

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
      h1: {fontSize: '1.6rem'},
      h2: {fontSize: '1.5rem'},
      h3: {fontSize: '1.4rem'},
      h4: {fontSize: '1.3rem'},
      h5: {fontSize: '1.2rem'},
      h6: {fontSize: '1.1rem'},
    },
  }), [mode])

  return (
    <Fragment>
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          {children}
        </ThemeProvider>
      </ColorModeContext.Provider>
    </Fragment>
  )
}


const ColorModeContext = createContext({toggleColorMode: () => {}})


const dark = {
  mode: 'dark',
  primary: {
    // TODO(pablo): this is a light teal for text in dark mode.  not sure why main key is used
    main: '#869fdb',
    light: '#0f0',
    dark: '#00f',
    contrastText: '#fff',
  },
}

const light = {
  mode: 'light',
  primary: {
    main: '#f00',
    light: '#0f0',
    dark: '#00f',
    contrastText: '#000',
  },
}
