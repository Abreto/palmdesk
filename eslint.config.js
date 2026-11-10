import js from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVars = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'none',
};

// Prettier owns formatting. These rules catch mistakes everywhere and keep
// the application code consistent.
export default tseslint.config(
  {
    name: 'palmdesk/ignores',
    ignores: [
      'dist/',
      'electron-dist/',
      'electron-release/',
      'native-bin/',
      'deploy/',
      '.local/',
      'components.d.ts',
      'auto-imports.d.ts',
      // BilldDesk scratch files, removed with the other leftovers in #67.
      'test/test.*',
    ],
  },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    name: 'palmdesk/defaults',
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', unusedVars],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-iterator': 'error',
      'no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'import/no-extraneous-dependencies': 'error',
    },
  },
  {
    name: 'palmdesk/javascript',
    files: ['**/*.{js,mjs,cjs}'],
    settings: {
      // Packages that only declare `exports` fall through to the TypeScript
      // resolver, which must pick their JavaScript, not their type declarations.
      'import/resolver': {
        node: true,
        typescript: {
          conditionNames: ['import', 'require', 'node', 'default'],
          mainFields: ['module', 'main'],
        },
      },
    },
  },
  {
    name: 'palmdesk/typescript',
    files: ['**/*.{ts,mts,cts,vue}'],
    extends: [tseslint.configs.strict],
    settings: {
      'import/resolver': { typescript: true, node: true },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedVars],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // Reactive records drop entries with `delete`.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // TypeScript and vue-tsc already check these.
      'import/named': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/no-unresolved': 'off',
    },
  },
  {
    name: 'palmdesk/vue',
    files: ['**/*.vue'],
    extends: [pluginVue.configs['flat/recommended']],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      // Optional props are typed as possibly undefined.
      'vue/require-default-prop': 'off',
    },
  },
  {
    // renderMarkdown escapes HTML and allows only http(s)/mailto links.
    name: 'palmdesk/session-reader',
    files: ['src/components/SessionReader/index.vue'],
    rules: { 'vue/no-v-html': 'off' },
  },
  {
    name: 'palmdesk/browser',
    files: ['src/**', 'session-core/public/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Playwright runs some test functions in the page, which also imports
    // modules from the fixture servers by URL path.
    name: 'palmdesk/tests',
    files: ['test/**', 'containers/test/**'],
    languageOptions: { globals: globals.browser },
    rules: { 'import/no-unresolved': ['error', { ignore: ['^/'] }] },
  },
  {
    // The renderer and the Electron main process follow the full style guide.
    name: 'palmdesk/application',
    files: ['src/**', 'electron-main/**'],
    rules: {
      camelcase: ['error', { properties: 'never' }],
      'spaced-comment': ['error', 'always', { exceptions: ['-', '+'] }],
      'no-underscore-dangle': 'error',
      'no-param-reassign': 'error',
      'no-nested-ternary': 'error',
      'no-plusplus': 'error',
      'prefer-template': 'error',
      'new-cap': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message:
            'for...in also walks the prototype chain; use Object.keys/values/entries.',
        },
      ],
      'require-await': 'error',
      'guard-for-in': 'error',
      'global-require': 'error',
      'object-shorthand': ['error', 'always'],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
            orderImportKind: 'asc',
          },
        },
      ],
      'import/newline-after-import': 'error',
    },
  },
  configPrettier
);
