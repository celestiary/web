import React, {Fragment, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import {createTheme, ThemeProvider} from '@mui/material/styles'
import Routed from './Routed'


/** @returns {React.Fragment} */
function Root({children}) {
  const [mode, setMode] = useState('dark')
  const colorMode = useMemo(() => ({toggleColorMode: () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'))
  }}), [])

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
    },
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
      <CssBaseline/>
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          <Routed/>
        </ThemeProvider>
      </ColorModeContext.Provider>
    </Fragment>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<Root/>)


const ColorModeContext = React.createContext({toggleColorMode: () => {} })
