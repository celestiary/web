import esbuild from 'esbuild'
import config from './common.js'


esbuild
    .build({...config, write: false, minify: false})
    .then(() => {
      console.log('Import check passed.')
    })
    .catch((err) => {
      console.error('Import check failed:', err)
      process.exit(1)
    })
