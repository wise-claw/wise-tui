/**
 * antd 6 在 `node_modules/antd/node_modules/` 下带了 `scroll-into-view-if-needed@3`，
 * 它用命名导入 `{ compute }`，但同树里解析到的 `compute-scroll-into-view@1` 只有默认导出，
 * Vite/esbuild 会报错：`No matching export ... for import "compute"`。
 *
 * 安装后把 antd 嵌套的那份替换为 `scroll-into-view-if-needed@2.2.31`（与 Semi 等一样走默认导入）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const PINNED = "2.2.31";
const antdNested = path.join(repoRoot, "node_modules/antd/node_modules/scroll-into-view-if-needed");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  if (!fs.existsSync(antdNested)) {
    return;
  }
  let ver;
  try {
    ver = readJson(path.join(antdNested, "package.json")).version;
  } catch {
    return;
  }
  if (ver === PINNED) {
    return;
  }
  if (!ver.startsWith("3.")) {
    return;
  }

  const tmp = path.join(repoRoot, "node_modules/.wise-patch-antd-scroll");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  execFileSync("npm", ["pack", `scroll-into-view-if-needed@${PINNED}`], { cwd: tmp, stdio: "inherit" });
  const tgz = path.join(tmp, `scroll-into-view-if-needed-${PINNED}.tgz`);
  if (!fs.existsSync(tgz)) {
    throw new Error(`[patch-antd-scroll] missing tarball: ${tgz}`);
  }
  execFileSync("tar", ["-xzf", tgz, "-C", tmp], { stdio: "inherit" });
  const extracted = path.join(tmp, "package");
  if (!fs.existsSync(extracted)) {
    throw new Error("[patch-antd-scroll] extract failed (no package/ dir)");
  }

  fs.rmSync(antdNested, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(antdNested), { recursive: true });
  fs.cpSync(extracted, antdNested, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`[patch-antd-scroll] replaced antd nested scroll-into-view-if-needed ${ver} -> ${PINNED}`);
}

main();
