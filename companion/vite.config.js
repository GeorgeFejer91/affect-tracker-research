import { defineConfig } from 'vite';
export default defineConfig({ root: import.meta.dirname, base: './', publicDir: false,
  build: { target: 'es2021', assetsInlineLimit: 0, outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 1422, strictPort: true } });
