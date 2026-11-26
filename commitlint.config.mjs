export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'test',
        'refactor',
        'style',
        'perf',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
  },
};
