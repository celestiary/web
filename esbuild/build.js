import esbuild from 'esbuild';
import * as common from './common.js';

common.build.minify = true;

esbuild
  .build(common.build)
  .then((result) => {
    console.log('Build succeeded.');
  })
  .catch(() => process.exit(1));
