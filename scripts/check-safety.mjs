// Fails the build if the source uses anything that would weaken the XSS
// and CSP story: eval-like calls, raw HTML injection, or remote URLs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES = [
  [/\beval\s*\(/, "eval()"],
  [/new\s+Function\s*\(/, "new Function()"],
  [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML"],
  [/\.innerHTML\s*=/, "innerHTML assignment"],
  [/\.outerHTML\s*=/, "outerHTML assignment"],
  [/insertAdjacentHTML/, "insertAdjacentHTML"],
  [/document\.write/, "document.write"],
  [/setTimeout\(\s*["'`]/, "string setTimeout"],
  [/\bfetch\s*\(\s*["'`]https?:/, "remote fetch"],
  [/<script[^>]+src=["']https?:/, "remote script"],
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

const files = [...walk(join(root, "src")), join(root, "index.html"), join(root, "public/theme-init.js")];
let bad = 0;
for (const f of files) {
  if (!/\.(tsx?|js|html|css)$/.test(f)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [re, label] of RULES) {
      if (re.test(line)) {
        console.error(`${relative(root, f)}:${i + 1}  forbidden: ${label}`);
        bad++;
      }
    }
  });
}
if (bad) {
  console.error(`\ncheck-safety: ${bad} problem(s)`);
  process.exit(1);
}
console.log(`check-safety: ${files.length} files clean`);
