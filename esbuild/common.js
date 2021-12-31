const entry = 'js/index.jsx';
const buildDir = 'docs';
const build = {
  entryPoints: [entry],
  outdir: buildDir,
  format: 'esm',
  target: ['es6'],
  sourcemap: true,
  bundle: true,
  // Splitting
  // Entry points (our src/index.jsx) are currently not named with
  // cache-busting segments, like index-x84nfi.js, so we should be
  // careful with our caching, i.e. not putting much index.jsx.
  // See:
  //   https://esbuild.github.io/api/#chunk-names
  //   https://github.com/evanw/esbuild/issues/16
  splitting: true,
  logLevel: 'info'
};

export { build };
