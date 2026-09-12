import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
export default defineConfig({
  root, publicDir: false, clearScreen: false,
  server: { port: 1421, strictPort: true, fs: { allow: [resolve(root, "..")] } },
  build: { target: ["es2021", "chrome105"], emptyOutDir: true, assetsInlineLimit: 0,
    rollupOptions: { input: { runner: resolve(root, "index.html") } } },
});
