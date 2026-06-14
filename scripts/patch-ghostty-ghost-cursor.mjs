/**
 * ghostty-web 0.4.0：CanvasRenderer 在光标从初始 (0,0) 移到同行时不会重绘旧行，
 * 导致左上角残留 ghost cursor（coder/ghostty-web#122）。
 * 对齐 diegosouzapw/ghostty-web@31ed228：光标移动后始终重绘上一光标所在行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const MARKER = "WISE_PATCH_GHOST_CURSOR";

const target = path.join(repoRoot, "node_modules/ghostty-web/dist/ghostty-web.js");

const needle =
  "if (s && this.lastCursorPosition.y !== I.y && !B && !A.isRowDirty(this.lastCursorPosition.y)) {";
const replacement = `if (s && !B) { // ${MARKER}`;

function main() {
  if (!fs.existsSync(target)) {
    return;
  }
  let text = fs.readFileSync(target, "utf8");
  if (text.includes(MARKER)) {
    return;
  }
  if (!text.includes(needle)) {
    console.warn("[patch-ghostty-ghost-cursor] skip (pattern not found)");
    return;
  }
  text = text.replace(needle, replacement);
  fs.writeFileSync(target, text, "utf8");
  console.log("[patch-ghostty-ghost-cursor] patched ghostty-web.js");
}

main();
