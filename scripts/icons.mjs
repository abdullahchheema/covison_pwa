// Renders the PNG app icons from public/logo.svg with resvg (runs locally,
// no network). Output goes to public/icons/ and is committed, so a normal
// build does not need this step. Re-run with `npm run icons` after editing
// the logo.
//
// - icon-180.png          apple-touch-icon. Full-bleed square: iOS applies
//                         its own rounded mask and fills transparency black.
// - icon-192.png/512.png  "any" purpose, rounded logo on transparency.
// - icon-512-maskable.png full-bleed background, glyph shrunk into the
//                         central 80% safe zone.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logo = readFileSync(join(root, "public/logo.svg"), "utf8");
const outDir = join(root, "public/icons");
mkdirSync(outDir, { recursive: true });

// Full-bleed variant: drop the corner radius on the background layers and
// the gloss clip, keep the glyph where it is.
const fullBleed = logo
  .replaceAll('rx="114"', 'rx="0"')
  .replace(/<path d="M114 0h284[^"]*"/, '<path d="M0 0h512v154C380 214 160 236 0 196Z"');

// Maskable variant: full-bleed background, glyph scaled to 78% around the centre.
const glyphStart = fullBleed.indexOf("<!-- the \"C\"");
const glyphEnd = fullBleed.lastIndexOf("</svg>");
const maskable =
  fullBleed.slice(0, glyphStart) +
  '<g transform="translate(256 256) scale(.78) translate(-256 -256)">' +
  fullBleed.slice(glyphStart, glyphEnd) +
  "</g></svg>";

function render(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(join(outDir, file), png);
  console.log(`wrote icons/${file} (${size}x${size})`);
}

render(fullBleed, 180, "icon-180.png");
render(logo, 192, "icon-192.png");
render(logo, 512, "icon-512.png");
render(maskable, 512, "icon-512-maskable.png");
render(logo, 32, "favicon-32.png");
