import esbuild from 'esbuild'
import * as common from './common.js'


// common.build.minify = true
common.build.minifyWhitespace = true
common.build.minifySyntax = true
// This is a big save but breaks three.js currently with esbuild 0.14.9
// common.build.minifyIdentifiers = true

esbuild
    .build(common.build)
    .then((result) => {
      console.log('Build succeeded.')
    })
    .catch(() => process.exit(1))
