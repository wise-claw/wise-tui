import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const distDir = join(projectRoot, "dist");
const assetsDir = join(distDir, "assets");
const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");

function fail(message) {
  console.error(`[build-performance] ${message}`);
  process.exitCode = 1;
}

const initialAssetRefs = Array.from(
  indexHtml.matchAll(/(?:src|href)=["']\/assets\/([^"']+)["']/g),
  (match) => match[1],
);
if (initialAssetRefs.some((name) => name.startsWith("mermaid-vendor-"))) {
  fail("index.html must not preload the deferred Mermaid vendor chunk");
}
if (initialAssetRefs.some((name) => name.startsWith("antd-vendor-"))) {
  fail("the framework-light loading shell must not preload the Ant Design vendor chunk");
}

const jsFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
const startupChunks = jsFiles.filter(
  (name) => name.startsWith("main-") || name.startsWith("AppImpl-"),
);
if (startupChunks.length === 0) {
  fail("could not find startup chunks in dist/assets");
}

for (const chunkName of startupChunks) {
  const source = readFileSync(join(assetsDir, chunkName), "utf8");
  if (/(?:from\s*|import\s*)["']\.\/mermaid-vendor-/.test(source)) {
    fail(`${basename(chunkName)} statically imports the deferred Mermaid vendor chunk`);
  }
}

if (!process.exitCode) {
  console.log("[build-performance] startup chunks keep Mermaid deferred");
}
