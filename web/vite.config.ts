import { defineConfig, type Plugin } from "vite";

// The web UI lives in web/ (run with `vite web`) and imports the engine straight from ../src.
//
// Three builds:
// - `npm run build:web`: web/dist, for any static host.
// - `npm run build:site`: the copy GitHub Pages serves, written to the repo root
//   (index.html and assets/) next to the house kit (manifest, icons, sw.js, og.png).
// - `npm run build:artifact`: one page for the Artifact viewer, fonts inlined and no downloads.
const site = Boolean(process.env.VITE_SITE);
const artifact = Boolean(process.env.VITE_NO_DOWNLOAD);

const URL = "https://junkdrawer.works/twenty-eighty/";

/** The junkdrawer.works head tags: link preview, icons, install and the phone's theme colour. */
function siteHead(): Plugin {
  const meta = (attrs: Record<string, string>) => ({ tag: "meta", attrs, injectTo: "head" as const });
  const link = (attrs: Record<string, string | boolean>) => ({ tag: "link", attrs, injectTo: "head" as const });
  return {
    name: "site-head",
    transformIndexHtml: () => [
      meta({ property: "og:title", content: "Twenty-Eighty" }),
      meta({ property: "og:description", content: "Run a ball club on the scouts' 20-80 scale." }),
      meta({ property: "og:image", content: `${URL}og.png` }),
      meta({ property: "og:url", content: URL }),
      meta({ name: "twitter:card", content: "summary_large_image" }),
      meta({ name: "theme-color", content: "#16372b", media: "(prefers-color-scheme: light)" }),
      meta({ name: "theme-color", content: "#0a120e", media: "(prefers-color-scheme: dark)" }),
      link({ rel: "manifest", href: "manifest.webmanifest" }),
      link({ rel: "icon", href: "icon.svg", type: "image/svg+xml" }),
      link({ rel: "apple-touch-icon", href: "icon-180.png" }),
      link({ rel: "preload", href: "assets/source-sans-3.woff2", as: "font", type: "font/woff2", crossorigin: true }),
      link({ rel: "preload", href: "assets/barlow-condensed-700.woff2", as: "font", type: "font/woff2", crossorigin: true }),
    ],
  };
}

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  plugins: site ? [siteHead()] : [],
  worker: {
    format: "es",
    rollupOptions: { output: { entryFileNames: "assets/[name].js" } },
  },
  build: {
    // The site goes to the repo root, so never empty it.
    outDir: site ? ".." : "dist",
    emptyOutDir: !site,
    target: "es2022",
    // The Artifact viewer gets its fonts inside the stylesheet.
    assetsInlineLimit: artifact ? 1_000_000 : 0,
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
