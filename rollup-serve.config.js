import { nodeResolve } from '@rollup/plugin-node-resolve';
import serve from 'rollup-plugin-serve'
import livereload from 'rollup-plugin-livereload'

export default {
  input: 'js/index.js',
  output: {
    file: 'Celestiary.js',
  },
  plugins: [
    nodeResolve(),
    serve(),
    livereload()
  ]
};
