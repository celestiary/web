import esbuild from 'esbuild'
import {STATIC_BUDGET} from './budget.js'
import config from './common.js'
import {firstLoadOutputs, firstLoadProblems} from './firstLoad.js'
import {budgetProblems, kb, measureFirstLoad} from './staticBudget.js'


// A minified dry run, so the sizes are the shipped ones.
esbuild
    .build({...config, write: false, minify: true, logLevel: 'error'})
    .then((result) => {
      const problems = firstLoadProblems(result.metafile)
      if (problems.length > 0) {
        throw new Error(`The first load holds what should load later:\n  ${problems.join('\n  ')}`)
      }
      const contents = new Map(result.outputFiles.map((f) => [relativePath(f.path), f.contents]))
      const measure = measureFirstLoad(result.metafile, (path) => contents.get(path))
      const over = budgetProblems(measure, STATIC_BUDGET)
      if (over.length > 0) {
        throw new Error(`The first load is over its budget (esbuild/budget.js):\n  ${over.join('\n  ')}\n` +
          '  Load the heavy part with a dynamic import(), or if the growth is intended raise the limit in ' +
          'esbuild/budget.js and say why in the PR.')
      }
      const files = firstLoadOutputs(result.metafile).length
      console.log(`Import check passed.  First load: ${files} scripts, ${kb(measure.minified)} minified, ` +
        `${kb(measure.gzip)} gzipped (budget ${STATIC_BUDGET.totalMinifiedKB} / ${STATIC_BUDGET.totalGzipKB} KB), ` +
        `largest ${kb(measure.largest.minified)} (budget ${STATIC_BUDGET.largestChunkMinifiedKB} KB), no VSOP87.`)
    })
    .catch((err) => {
      console.error('Import check failed:', err.message ?? err)
      process.exit(1)
    })


/**
 * @param {string} absolute An output file's absolute path
 * @returns {string} the path as the metafile names it, relative to the
 *   working directory
 */
function relativePath(absolute) {
  return absolute.startsWith(`${process.cwd()}/`) ? absolute.slice(process.cwd().length + 1) : absolute
}
