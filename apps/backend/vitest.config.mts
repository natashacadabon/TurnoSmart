import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          env: { NODE_ENV: 'test' },
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
