// Renders every PNG icon and iOS launch image from the real Covison mark
// (public/logo-mark.png, copied from web/public/logo-mark.png) with resvg.
// Runs locally, no network. Output is committed, so a normal build doesn't
// need it. Re-run with `npm run icons` after changing the logo.
//
// - icons/icon-180.png          apple-touch-icon. Opaque square on the ink
//                               plate (same as web/src/app/apple-icon.tsx);
//                               iOS applies its own rounded mask.
// - icons/icon-192.png, 512     "any" purpose, rounded plate.
// - icons/icon-512-maskable.png full-bleed plate, mark inside the 80% safe zone.
// - icons/favicon-32.png        mark only.
// - splash/*.png                apple-touch-startup-image for iPhone 12 Pro Max
//                               (1284x2778), light and dark. Same layout as the
//                               HTML splash so launch flows into the app.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mark = `data:image/png;base64,${readFileSync(join(root, "public/logo-mark.png")).toString("base64")}`;
const out = (p) => {
  const f = join(root, "public", p);
  mkdirSync(dirname(f), { recursive: true });
  return f;
};

const INK = "#120f1a";

function plate({ size, radius, markScale }) {
  const m = size * markScale;
  const o = (size - m) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="46%" r="62%">
      <stop offset="0" stop-color="#6d4aff" stop-opacity=".38"/>
      <stop offset="1" stop-color="#6d4aff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".10"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="${INK}"/>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#glow)"/>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#gloss)"/>
  <image href="${mark}" x="${o}" y="${o}" width="${m}" height="${m}"/>
</svg>`;
}

function splash({ w, h, bg, glow }) {
  const m = 288; // 96pt at 3x, matches .boot-logo in public/boot.css
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#6d4aff" stop-opacity="${glow}"/>
      <stop offset="1" stop-color="#6d4aff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <circle cx="${w / 2}" cy="${h / 2}" r="${m * 1.4}" fill="url(#g)"/>
  <image href="${mark}" x="${(w - m) / 2}" y="${(h - m) / 2}" width="${m}" height="${m}"/>
</svg>`;
}

function render(svg, file, width) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(out(file), png);
  console.log(`wrote ${file}`);
}

render(plate({ size: 180, radius: 0, markScale: 0.78 }), "icons/icon-180.png", 180);
render(plate({ size: 512, radius: 112, markScale: 0.74 }), "icons/icon-192.png", 192);
render(plate({ size: 512, radius: 112, markScale: 0.74 }), "icons/icon-512.png", 512);
render(plate({ size: 512, radius: 0, markScale: 0.62 }), "icons/icon-512-maskable.png", 512);
render(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="${mark}" width="64" height="64"/></svg>`, "icons/favicon-32.png", 32);
render(splash({ w: 1284, h: 2778, bg: "#09090b", glow: 0.22 }), "splash/iphone-1284x2778-dark.png", 1284);
render(splash({ w: 1284, h: 2778, bg: "#f8f7f4", glow: 0.12 }), "splash/iphone-1284x2778-light.png", 1284);
