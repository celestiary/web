import esbuild from 'esbuild'
import config from './common.js'
import {firstLoadOutputs, firstLoadProblems, totalBytes} from './firstLoad.js'


esbuild
    .build({...config, write: false, minify: false})
    .then((result) => {
      const problems = firstLoadProblems(result.metafile)
      if (problems.length > 0) {
        throw new Error(`The first load holds what should load later:\n  ${problems.join('\n  ')}`)
      }
      const first = firstLoadOutputs(result.metafile)
      const kb = Math.round(totalBytes(result.metafile, first) / 1024)
      console.log(`Import check passed.  First load: ${first.length} files, ${kb} KB unminified, no VSOP87.`)
    })
    .catch((err) => {
      console.error('Import check failed:', err)
      process.exit(1)
    })
