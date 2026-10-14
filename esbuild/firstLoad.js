// What the first load fetches, read from esbuild's metafile, so the build
// can say what must stay out of it (esbuild/check.js; the CI load budget,
// #256, grows from this).
//
// The first load is the page's entry (js/index.tsx), the App route it lazy-
// loads at once (js/Routed.jsx), and everything either imports statically.
// A dynamic `import()` is a separate fetch, later: it doesn't count.

/** The inputs that must stay out of the first load: the planets' series. */
export const DEFERRED_INPUTS = [/node_modules\/vsop87\//, /^js\/vsop\.js$/]

/** The output files' entry points the first load starts from. */
export const FIRST_LOAD_ENTRIES = ['js/index.tsx', 'js/App.jsx']


/**
 * @param {object} metafile esbuild's, from a build with `metafile: true`
 * @param {string[]} [entries] entry points (as the metafile names them)
 * @returns {string[]} the output files fetched by the first load: those
 *   entries' outputs and their static imports, transitively
 */
export function firstLoadOutputs(metafile, entries = FIRST_LOAD_ENTRIES) {
  const outputs = metafile.outputs
  const seen = new Set()
  const stack = Object.keys(outputs).filter((k) => entries.includes(outputs[k].entryPoint))
  if (stack.length < entries.length) {
    throw new Error(`first-load entries not in the build: ${entries.join(', ')}`)
  }
  while (stack.length > 0) {
    const out = stack.pop()
    if (seen.has(out)) {
      continue
    }
    seen.add(out)
    for (const imp of outputs[out].imports) {
      if (imp.kind === 'import-statement' && outputs[imp.path]) {
        stack.push(imp.path)
      }
    }
  }
  return [...seen]
}


/**
 * @param {object} metafile
 * @param {RegExp[]} [patterns] input paths to look for
 * @returns {Object<string, string[]>} for each output file, the inputs
 *   matching a pattern
 */
export function outputsWithInputs(metafile, patterns = DEFERRED_INPUTS) {
  const found = {}
  for (const [out, info] of Object.entries(metafile.outputs)) {
    const inputs = Object.keys(info.inputs).filter((i) => patterns.some((p) => p.test(i)))
    if (inputs.length > 0) {
      found[out] = inputs
    }
  }
  return found
}


/**
 * @param {object} metafile
 * @returns {string[]} what is wrong, empty if the deferred inputs are out of
 *   the first load and are in the build, in a chunk of their own
 */
export function firstLoadProblems(metafile) {
  const problems = []
  const deferred = outputsWithInputs(metafile)
  if (Object.keys(deferred).length === 0) {
    return ['no vsop87 in the build at all: has the check gone stale?']
  }
  const first = new Set(firstLoadOutputs(metafile))
  for (const [out, inputs] of Object.entries(deferred)) {
    if (first.has(out)) {
      problems.push(`${out} is in the first load and holds ${inputs.join(', ')}: ` +
        'import it dynamically (import(\'../vsop\')), not statically')
    }
  }
  return problems
}


/**
 * @param {object} metafile
 * @param {string[]} outputs output file names
 * @param {function(string): number} sizeOf bytes of an output file
 * @returns {number} the outputs' total bytes
 */
export function totalBytes(metafile, outputs, sizeOf = (out) => metafile.outputs[out].bytes) {
  return outputs.reduce((sum, out) => sum + sizeOf(out), 0)
}
