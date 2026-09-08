import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const tsConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: ['apps/backend/**/*.{ts,tsx,mts,cts}', 'packages/shared/**/*.{ts,tsx,mts,cts}'],
}));

const frontendConfigs = [...nextCoreWebVitals, ...nextTypescript].map((config) => ({
  ...config,
  files: ['apps/frontend/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
  settings: {
    ...config.settings,
    next: {
      ...config.settings?.next,
      rootDir: 'apps/frontend',
    },
  },
}));

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/out/**',
    '**/next-env.d.ts',
  ]),

  ...frontendConfigs,

  {
    files: ['apps/backend/**/*.js', 'packages/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  ...tsConfigs,

  {
    files: ['apps/backend/**/*.{ts,tsx,mts,cts}', 'packages/shared/**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    rules: {
      ...eslintConfigPrettier.rules,
    },
  },
]);
