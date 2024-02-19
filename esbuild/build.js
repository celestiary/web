import esbuild from 'esbuild'
import config from './common.js'


esbuild
    .build(config)
    .then((result) => {
      console.log(`Build succeeded.`)
    })
    .catch((err) => {
      console.error(`Build failed:`, err)
      process.exit(1)
    })
