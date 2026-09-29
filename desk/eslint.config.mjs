// Paddock's lint. Deliberately small: the TypeScript compiler already runs strict (npm run
// typecheck), so this adds what the compiler cannot see -- mainly React's hooks rules (stale
// closures, missing effect dependencies, conditional hooks) and typescript-eslint's recommended
// set. Style is not linted; a rule earns its place here by catching a class of bug.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'resources/**', '**/*.tmp.cjs', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // One convention: a leading underscore marks a deliberately unused name, e.g. a key dropped by
    // destructuring (`const { notifyUrl: _refused, ...rest } = patch`).
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // Build scripts are plain CommonJS run by Node.
    files: ['scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Test doubles stand in for loosely typed Electron and SDK objects; `any` there is the honest
    // type. Production code gets no such allowance.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
