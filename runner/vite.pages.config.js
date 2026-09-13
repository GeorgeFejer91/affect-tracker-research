import { resolve } from "node:path";
import { defineConfig } from "vite";
import { surveyNoticesPlugin } from "../scripts/surveyjs-notices-vite.js";

const root = import.meta.dirname;
export default defineConfig({
  plugins: [surveyNoticesPlugin()],
  root,
  base: "./",
  publicDir: false,
  clearScreen: false,
  build: {
    target: ["es2021", "chrome105"],
    outDir: resolve(root, "../dist-pages/runner"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { browser: resolve(root, "browser.html") },
    },
  },
});
