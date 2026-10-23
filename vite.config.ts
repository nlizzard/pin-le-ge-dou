import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
