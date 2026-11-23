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
      'apps/ios-native/DerivedData/**',
      '**/.wrangler/**',
      '.ralph/**',
      // 로컬 도구·작업 사본(추적하지 않는다). 그 안의 워크트리 사본이 tsconfig 를 가지고 있어 린트가 루트를 헷갈렸다.
      '.claude/**',
      '**/test/**',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    // 저장소 루트를 못 박는다 — typescript-eslint 8.73 부터 tsconfig 후보 루트가 여럿이면 모든 파일을 파싱 오류로 막는다.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },

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
    files: ['packages/backend/scripts/**/*.ts', 'packages/voice/text-quality/cli.ts', 'apps/landing/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  eslintConfigPrettier,
);
