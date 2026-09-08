const config = {
  'apps/frontend/**/*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  'apps/backend/**/*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  'packages/shared/**/*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '**/*.{json,md,yml,yaml,css}': ['prettier --write'],
};

export default config;
