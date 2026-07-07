import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/android-native/**/build/**',
      '**/.wrangler/**',
      '.ralph/**',
      '**/test/**',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ['**/*.cjs', '**/*.mjs', '**/babel.config.js', '**/metro.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // CLI 운영 스크립트·빌드 스크립트는 stdout 출력이 본업이라 console 사용을 허용한다.
    // (메인 rules 블록 뒤에 와야 no-console 비활성이 적용된다.)
    files: ['packages/backend/scripts/**/*.ts', 'apps/landing/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  eslintConfigPrettier,
);
