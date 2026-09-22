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

const frontendFiles = ['apps/frontend/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const frontendTypeScriptFiles = ['apps/frontend/**/*.{ts,tsx,mts,cts}'];
const nodeJavaScriptFiles = ['apps/backend/**/*.{js,mjs,cjs}', 'packages/shared/**/*.{js,mjs,cjs}'];
const nodeTypeScriptFiles = [
  'apps/backend/**/*.{ts,tsx,mts,cts}',
  'packages/shared/**/*.{ts,tsx,mts,cts}',
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/generated/**',
    '**/out/**',
    '**/next-env.d.ts',
  ]),

  ...frontendConfigs,

  {
    files: frontendFiles,
    languageOptions: {
      globals: globals.browser,
    },
  },

  {
    files: frontendTypeScriptFiles,
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    files: nodeJavaScriptFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-restricted-globals': ['error', 'window', 'document'],
    },
  },

  ...tsConfigs,

  {
    files: nodeTypeScriptFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-globals': ['error', 'window', 'document'],
    },
  },

  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    rules: {
      ...eslintConfigPrettier.rules,
    },
  },
]);
