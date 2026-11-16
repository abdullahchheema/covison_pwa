import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { serviceWorkerPlugin } from "./scripts/sw-plugin";

// The dev server injects CSS through <style> tags and an HMR client, which
// the strict CSP would block. Strip the CSP meta in `vite dev` only; the
// production build keeps it untouched.
function devCspRelax(): Plugin {
  return {
    name: "dev-csp-relax",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
    },
  };
}

// base: "./" keeps every asset URL relative, so the build works from any
// subpath (GitHub Pages /repo/, Cloudflare Pages, a local folder).
export default defineConfig({
  base: "./",
  plugins: [preact(), devCspRelax(), serviceWorkerPlugin()],
  build: {
    outDir: "dist",
    target: "es2020",
    assetsInlineLimit: 0, // no data: URIs for scripts; keeps CSP simple
    sourcemap: false,
    modulePreload: { polyfill: false }, // the polyfill is an inline script
  },
});
