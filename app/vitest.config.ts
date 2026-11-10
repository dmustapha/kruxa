import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Component tests opt into jsdom with a `// @vitest-environment jsdom` docblock; lib tests stay on node.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['lib/**/*.test.ts', 'components/**/*.test.{ts,tsx}', 'content/**/*.test.ts'] },
});
