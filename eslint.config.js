const js = require('@eslint/js')
const google = require('eslint-config-google')
const importPlugin = require('eslint-plugin-import')
const jsdoc = require('eslint-plugin-jsdoc')
const jsxA11y = require('eslint-plugin-jsx-a11y')
const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')
const globals = require('globals')


module.exports = [
  {ignores: ['js/index.js', 'js/guide/bruneton-atmos/**']},
  js.configs.recommended,
  {
    rules: Object.fromEntries(
      // require-jsdoc and valid-jsdoc were removed in ESLint 9
      Object.entries(google.rules).filter(([k]) => !['require-jsdoc', 'valid-jsdoc'].includes(k)),
    ),
  },
  react.configs.flat.recommended,
  {
    plugins: {'react-hooks': reactHooks},
    rules: reactHooks.configs.recommended.rules,
  },
  jsxA11y.flatConfigs.recommended,
  jsdoc.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        ecmaFeatures: {jsx: true},
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    settings: {
      react: {version: '18.3.1'},
    },
    rules: {
      'arrow-parens': ['error', 'always'],
      'arrow-spacing': ['error', {before: true, after: true}],
      'block-spacing': 'error',
      'brace-style': 'error',
      'comma-style': ['error', 'last'],
      'curly': ['error', 'all'],
      'default-case': 'error',
      'default-param-last': ['error'],
      'eol-last': ['error', 'always'],
      'eqeqeq': ['error', 'always'],
      'func-call-spacing': ['error', 'never'],
      'import/newline-after-import': ['error', {count: 2}],
      'jsdoc/check-param-names': 'off',
      'jsdoc/check-types': 'error',
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/tag-lines': ['error', 'any', {startLines: 1}],
      'max-len': ['error', 140],
      'no-alert': 'error',
      'no-empty-function': 'error',
      'no-eq-null': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-invalid-this': 'error',
      'no-irregular-whitespace': ['error'],
      'no-lone-blocks': 'error',
      'no-lonely-if': 'error',
      'no-loop-func': 'error',
      'no-mixed-operators': 'error',
      'no-multi-assign': ['error', {ignoreNonDeclaration: true}],
      'no-multiple-empty-lines': ['error', {max: 2, maxEOF: 1}],
      'no-return-assign': 'error',
      'no-shadow': 'error',
      'no-trailing-spaces': ['error'],
      'no-undef-init': 'error',
      'no-unneeded-ternary': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-concat': 'error',
      'no-useless-constructor': 'error',
      'no-useless-return': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'off',
      'prefer-template': 'error',
      'quote-props': ['error', 'consistent-as-needed'],
      'react/jsx-closing-bracket-location': 'error',
      'react/jsx-equals-spacing': [2, 'never'],
      'react/prop-types': 'off',
      'require-await': 'error',
      'semi': ['error', 'never'],
      'space-infix-ops': ['error'],
      'valid-jsdoc': 'off',
      'yoda': 'error',
    },
  },
  // Test files: relax rules that conflict with stub/mock patterns (must be last to win)
  {
    files: ['**/*.test.js'],
    rules: {
      'no-empty-function': 'off',
      'no-useless-constructor': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-returns': 'off',
      'import/no-unresolved': ['error', {ignore: ['^bun:']}],
      'import/no-duplicates': 'off',
    },
  },
]
