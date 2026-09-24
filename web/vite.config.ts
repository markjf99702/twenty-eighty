import { defineConfig } from "vite";

// The web UI lives in web/ (run with `vite web`) and imports the engine straight from ../src.
export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  worker: {
    format: "es",
    rollupOptions: { output: { entryFileNames: "assets/[name].js" } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: { fs: { allow: [".."] } },
});
