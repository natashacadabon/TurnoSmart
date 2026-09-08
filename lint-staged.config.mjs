const config = {
  'apps/frontend/**/*.{js,jsx,ts,tsx,mjs,cjs}': [
    'eslint --fix --config apps/frontend/eslint.config.mjs',
    'prettier --write',
  ],
  'apps/backend/**/*.{js,jsx,ts,tsx,mjs,cjs}': [
    'eslint --fix --config eslint.config.mjs',
    'prettier --write',
  ],
  'packages/shared/**/*.{js,jsx,ts,tsx,mjs,cjs}': [
    'eslint --fix --config eslint.config.mjs',
    'prettier --write',
  ],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
};

export default config;
