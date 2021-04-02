import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'js/index.js',
  output: {
    file: 'Celestiary.js',
  },
  plugins: [nodeResolve()]
};
