import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // O Chromium é um recurso único e caro; testes em paralelo brigam por ele.
    fileParallelism: false,
  },
});
