import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/release/**',
      '**/dist/**',
      'benchmarks/**',
      '.wolf/**',
      '.codex/**',
      '.claude/**',
      '.cursor/**',
      'tests/desktop/*.png',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  // Renderer layering: shared → features → app. Keeps features independent.
  {
    files: ['apps/desktop/src/renderer/src/features/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./[^.]',
              message:
                'Features must not import other features. Move shared code to components/, hooks/ or lib/.',
            },
            { regex: '(^|/)app/', message: 'Features must not import the app layer.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/src/{components,hooks,lib}/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(features|app)/',
              message: 'Shared code must not depend on features or the app layer.',
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright evaluates callbacks in pages; test doubles stand in for DOM/Electron types.
    files: ['tests/**', '**/*.test.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
);
