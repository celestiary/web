const indexFile = './js/index.jsx'
const buildDir = 'docs'

// The build config
export default {
  entryPoints: [indexFile],
  outdir: buildDir,
  format: 'esm',
  platform: 'browser',
  target: ['es2021', 'chrome63', 'edge79', 'firefox67', 'safari11.1'],
  bundle: true,
  minify: (process.env.MINIFY || 'true') === 'true',
  keepNames: true, // TODOD(pablo): have had breakage without this
  splitting: true,
  metafile: true,
  sourcemap: true,
  logLevel: 'info',
}
