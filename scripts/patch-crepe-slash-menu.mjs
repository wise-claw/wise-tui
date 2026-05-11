/**
 * Crepe 块侧「+」slash 菜单默认挂在 view.dom 父级且用 absolute 定位，在多层 overflow 的宿主内会被裁切或立刻判定关闭。
 * 安装依赖后为 @milkdown/crepe 的 SlashProvider 补上 root: document.body + strategy: fixed（与上游 menu/index.ts 一致）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function isCrepeSlashPatched(text) {
  return (
    text.includes('floatingUIOptions: { strategy: "fixed" }')
    || text.includes("floatingUIOptions: { strategy: 'fixed' }")
  );
}

const targets = [
  path.join(repoRoot, "node_modules/@milkdown/crepe/lib/esm/feature/block-edit/index.js"),
  path.join(repoRoot, "node_modules/@milkdown/crepe/lib/cjs/feature/block-edit/index.js"),
  path.join(repoRoot, "node_modules/@milkdown/crepe/src/feature/block-edit/menu/index.ts"),
];

const needleEsmCjs = `      debounce: 20,
      shouldShow(`;

const replacementEsm = `      debounce: 20,
      root: typeof document !== "undefined" ? document.body : void 0,
      floatingUIOptions: { strategy: "fixed" },
      shouldShow(`;

const needleSrc = `      debounce: 20,
      shouldShow(this: SlashProvider, view: EditorView) {`;

const replacementSrc = `      debounce: 20,
      /** 挂到 body，避免宿主（如 PRD 面板多层 overflow）裁切；与 fixed 策略配套 */
      root: typeof document !== 'undefined' ? document.body : undefined,
      floatingUIOptions: { strategy: 'fixed' },
      shouldShow(this: SlashProvider, view: EditorView) {`;

function patchFile(absPath, needle, replacement) {
  if (!fs.existsSync(absPath)) {
    return "skip-missing";
  }
  let text = fs.readFileSync(absPath, "utf8");
  if (isCrepeSlashPatched(text)) {
    return "skip-done";
  }
  if (!text.includes(needle)) {
    return "skip-no-match";
  }
  const next = text.replace(needle, replacement);
  if (next === text) {
    return "skip-no-op";
  }
  fs.writeFileSync(absPath, next, "utf8");
  return "patched";
}

let patched = 0;
for (const abs of targets) {
  const isSrc = abs.endsWith(".ts");
  const needle = isSrc ? needleSrc : needleEsmCjs;
  const replacement = isSrc ? replacementSrc : replacementEsm;
  const r = patchFile(abs, needle, replacement);
  if (r === "patched") {
    patched += 1;
    console.log(`[patch-crepe-slash] patched ${path.relative(repoRoot, abs)}`);
  } else if (r === "skip-missing") {
    console.warn(`[patch-crepe-slash] skip missing: ${path.relative(repoRoot, abs)}`);
  } else if (r === "skip-no-match") {
    console.warn(`[patch-crepe-slash] skip no-match (crepe layout changed?): ${path.relative(repoRoot, abs)}`);
  }
}

if (patched > 0) {
  console.log(`[patch-crepe-slash] done (${patched} file(s))`);
}
