import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [{
  input: 'howto.js',
  output: {
    file: 'howto-bundle.js'
  },
  plugins: [nodeResolve()]
}];
