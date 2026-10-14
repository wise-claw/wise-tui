import { createHash } from "node:crypto";
import { existsSync, lstatSync, readlinkSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function hashPaths(root, paths) {
  const hash = createHash("sha256");
  function visit(relative) {
    const path = join(root, relative);
    hash.update(JSON.stringify(relative));
    if (!existsSync(path)) { hash.update("missing"); return; }
    const entries = readdirOrNull(path);
    if (entries) {
      hash.update("directory");
      for (const entry of entries.sort()) visit(join(relative, entry));
    } else { hash.update("file"); hash.update(readFileSync(path)); }
  }
  for (const path of [...paths].sort()) visit(path);
  return hash.digest("hex");
}
function readdirOrNull(path) {
  try { return readdirSync(path); } catch (error) { if (error.code === "ENOTDIR") return null; throw error; }
}
export function dependencyStamp(root) {
  const hash = createHash("sha256");
  function visit(path) {
    const stat = lstatSync(path);
    hash.update(JSON.stringify(stat.isDirectory() ? [path, "directory"] : [path, stat.size, stat.mtimeMs, stat.ctimeMs]));
    if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
    else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry !== ".cache" && entry !== ".vite" && entry !== ".vite-temp") visit(join(path, entry));
      }
    }
  }
  visit(join(root, "node_modules"));
  return hash.digest("hex");
}
export function canReuseBuild(cache, inputHash, outputHash) {
  return cache?.inputHash === inputHash && cache?.outputHash === outputHash;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cachePath = join(root, "node_modules/.cache/wise/frontend-build.json");
  const local = process.env.WISE_LOCAL_BUILD === "1";
  const inputs = ["src", "public", "index.html", "mascot.html", "hud.html", "vite.config.ts", "tsconfig.app.json", "tsconfig.json", "tsconfig.node.json", "package.json", "bun.lock", "node_modules/vscode-material-icons/generated/icons", "scripts/build-frontend.mjs", "scripts/check-build-performance.mjs", ...readdirSync(root).filter(name => name.startsWith(".env"))];
  // Dependency metadata catches installs/patches without hashing every vendor file.
  const env = Object.entries(process.env).filter(([key]) => key.startsWith("VITE_") || key === "NODE_ENV").sort();
  const inputHash = local ? createHash("sha256").update(hashPaths(root, inputs)).update(dependencyStamp(root)).update(JSON.stringify(env)).update(process.version).update(process.versions.bun ?? "").digest("hex") : null;
  let cache;
  try { cache = JSON.parse(readFileSync(cachePath, "utf8")); } catch {}
  const outputHash = local && existsSync(join(root, "dist/index.html")) ? hashPaths(root, ["dist"]) : null;
  if (local && outputHash && canReuseBuild(cache, inputHash, outputHash)) {
    console.log("[build] 前端输入与产物未变，复用已验证构建");
    return;
  }
  for (const args of [["x", "tsc", "-p", "tsconfig.app.json"], ["x", "vite", "build"], ["run", "scripts/check-build-performance.mjs"]]) {
    const result = spawnSync("bun", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (local) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ inputHash, outputHash: hashPaths(root, ["dist"]) }));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
