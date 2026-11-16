// Vite plugin: after the build is written, list every file in dist/, hash
// their contents and emit dist/sw.js from scripts/sw-template.js with the
// precache list and a content-derived version baked in. Any change to any
// shipped file produces a new cache name, so updates are always atomic.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "covison-service-worker",
    apply: "build",
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join("/"))
        .filter((f) => f !== "sw.js")
        .sort();
      const template = readFileSync(resolve(config.root, "scripts/sw-template.js"), "utf8");
      const hash = createHash("sha256");
      hash.update(template); // a worker-only change must also produce a new version
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const version = hash.digest("hex").slice(0, 12);
      const precache = ["./", ...files.map((f) => `./${f}`)];
      const sw = template
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, "sw.js"), sw);
      writeFileSync(
        join(outDir, "precache-manifest.json"),
        JSON.stringify({ version, files: precache }, null, 2),
      );
      // precache-manifest.json itself is not precached; it is only used by tests.
      console.log(`[sw] version ${version}, ${precache.length} precached URLs`);
    },
  };
}
