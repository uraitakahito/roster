import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'dependabot/.claude/skills/**/*.test.ts'],
    environment: 'node',
  },
});
