/**
 * ghostty-web KeyEncoder 默认可能输出 CSI-u / Kitty 键盘序列；
 * zsh 未启用对应协议时会把 `6;5u` 等碎片 echo 到行上。
 * 强制关闭 Kitty flags 与 modifyOtherKeys，仅保留传统 xterm 编码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const MARKER = "WISE_PATCH_KEYBOARD_PROTOCOL";

const target = path.join(repoRoot, "node_modules/ghostty-web/dist/ghostty-web.js");

const needle =
  "this.encoder = A.createKeyEncoder(), this.container = B";
const replacement =
  `this.encoder = A.createKeyEncoder(), this.encoder.setKittyFlags(0), this.encoder.setOption(H.MODIFY_OTHER_KEYS_STATE_2, !1), this.container = B`;

function main() {
  if (!fs.existsSync(target)) {
    return;
  }
  let text = fs.readFileSync(target, "utf8");
  if (text.includes(MARKER)) {
    return;
  }
  if (!text.includes(needle)) {
    console.warn("[patch-ghostty-keyboard-protocol] skip (pattern not found)");
    return;
  }
  text = text.replace(
    needle,
    `${replacement} /* ${MARKER} */`,
  );
  fs.writeFileSync(target, text, "utf8");
  console.log("[patch-ghostty-keyboard-protocol] patched ghostty-web.js");
}

main();
