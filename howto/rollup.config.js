import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [{
  input: 'howto/howto.js',
  output: {
    file: 'howto/howto-bundle.js'
  },
  plugins: [nodeResolve()]
}];
