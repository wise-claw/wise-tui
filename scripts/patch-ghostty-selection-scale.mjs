/**
 * ghostty-web 0.4.0：pixelToCell 直接用 offsetX/offsetY，未考虑 canvas 显示尺寸
 * 与逻辑尺寸（cols*cellWidth）不一致时的缩放，导致拖拽选区错位、断裂。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const MARKER = "WISE_PATCH_SELECTION_SCALE";

const target = path.join(repoRoot, "node_modules/ghostty-web/dist/ghostty-web.js");

const needle = `pixelToCell(A, B) {
    const g = this.renderer.getMetrics(), E = Math.floor(A / g.width), C = Math.floor(B / g.height);
    return {
      col: Math.max(0, Math.min(E, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(C, this.terminal.rows - 1))
    };
  }`;

const replacement = `pixelToCell(A, B) { // ${MARKER}
    const U = this.renderer.getCanvas(), H = U.getBoundingClientRect(), g = this.renderer.getMetrics(), W = this.terminal.cols * g.width, R = this.terminal.rows * g.height, sX = H.width > 0 ? W / H.width : 1, sY = H.height > 0 ? R / H.height : 1, E = Math.floor(A * sX / g.width), C = Math.floor(B * sY / g.height);
    return {
      col: Math.max(0, Math.min(E, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(C, this.terminal.rows - 1))
    };
  }`;

function main() {
  if (!fs.existsSync(target)) {
    return;
  }
  let text = fs.readFileSync(target, "utf8");
  if (text.includes(MARKER)) {
    return;
  }
  if (!text.includes(needle)) {
    console.warn("[patch-ghostty-selection-scale] skip (pattern not found)");
    return;
  }
  text = text.replace(needle, replacement);
  fs.writeFileSync(target, text, "utf8");
  console.log("[patch-ghostty-selection-scale] patched ghostty-web.js");
}

main();
