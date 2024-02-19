const indexFile = './js/index.jsx'
const buildDir = 'docs'

// The build config
export default {
  entryPoints: [indexFile],
  outdir: buildDir,
  format: 'esm',
  platform: 'browser',
  target: ['chrome64', 'firefox62', 'safari11.1', 'edge79', 'es2021'],
  bundle: true,
  minify: (process.env.MINIFY_BUILD || 'true') === 'true',
  keepNames: true, // TODOD(pablo): have had breakage without this
  splitting: false,
  metafile: true,
  sourcemap: true,
  logLevel: 'info',
}
