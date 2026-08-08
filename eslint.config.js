import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'tests/fixtures/**', 'docs/.vitepress/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // The project convention is snake_case for values and types alike.
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['snake_case'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        { selector: 'variable', format: ['snake_case', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['snake_case'] },
        { selector: 'enumMember', format: ['snake_case', 'UPPER_CASE'] },
        // Names we do not own.
        { selector: 'import', format: null },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'objectLiteralMethod', format: null },
        { selector: 'typeProperty', format: null },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['*.config.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
);
