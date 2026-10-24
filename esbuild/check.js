import esbuild from 'esbuild'
import {LAYER_BUDGET, STATIC_BUDGET} from './budget.js'
import config, {layerConfig} from './common.js'
import {firstLoadOutputs, firstLoadProblems} from './firstLoad.js'
import {budgetProblems, kb, measureFirstLoad} from './staticBudget.js'


// A minified dry run, so the sizes are the shipped ones.
const dryRun = (c) => esbuild.build({...c, write: false, minify: true, logLevel: 'error'})
Promise.all([dryRun(config), dryRun(layerConfig)])
    .then(([result, layerResult]) => {
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
      const layerContents = new Map(layerResult.outputFiles.map((f) => [relativePath(f.path), f.contents]))
      const layer = measureFirstLoad(layerResult.metafile, (path) => layerContents.get(path), undefined, LAYER_BUDGET.entries)
      const layerOver = budgetProblems(layer, LAYER_BUDGET)
      if (layerOver.length > 0) {
        throw new Error(`Layer mode's page is over its budget (esbuild/budget.js LAYER_BUDGET):\n  ${layerOver.join('\n  ')}`)
      }
      const files = firstLoadOutputs(result.metafile).length
      console.log(`Import check passed.  First load: ${files} scripts, ${kb(measure.minified)} minified, ` +
        `${kb(measure.gzip)} gzipped (budget ${STATIC_BUDGET.totalMinifiedKB} / ${STATIC_BUDGET.totalGzipKB} KB), ` +
        `largest ${kb(measure.largest.minified)} (budget ${STATIC_BUDGET.largestChunkMinifiedKB} KB), no VSOP87.  ` +
        `Layer page: ${kb(layer.minified)} minified, ${kb(layer.gzip)} gzipped ` +
        `(budget ${LAYER_BUDGET.totalMinifiedKB} / ${LAYER_BUDGET.totalGzipKB} KB).`)
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
