import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs', 'tests/integration/**/*.test.mjs', 'tests/security/**/*.test.mjs'],
  },
});
