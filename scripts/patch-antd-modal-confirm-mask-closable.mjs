/**
 * antd 6：ConfirmDialog 渲染 Modal 时使用 `...props`，会把已废弃的 `maskClosable` 一并传入，
 * 触发 `[antd: Modal] maskClosable is deprecated`（即使业务代码已改用 `mask.closable`）。
 * 安装依赖后从展开对象中剔除 `maskClosable`，与下方显式传入的 `mask: mergedMask` 一致。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const MARKER = "WISE_PATCH_OMIT_MASK_CLOSABLE";

const patches = [
  {
    needle: `  return /*#__PURE__*/React.createElement(Modal, {
    ...props,`,
    replacement: `  // ${MARKER}
  const { maskClosable: _wiseOmitMaskClosable, ...wiseModalProps } = props;
  return /*#__PURE__*/React.createElement(Modal, {
    ...wiseModalProps,`,
  },
  {
    needle: `  return /*#__PURE__*/React.createElement(_Modal.default, {
    ...props,`,
    replacement: `  // ${MARKER}
  const { maskClosable: _wiseOmitMaskClosable, ...wiseModalProps } = props;
  return /*#__PURE__*/React.createElement(_Modal.default, {
    ...wiseModalProps,`,
  },
];

const targets = [
  path.join(repoRoot, "node_modules/antd/es/modal/ConfirmDialog.js"),
  path.join(repoRoot, "node_modules/antd/lib/modal/ConfirmDialog.js"),
];

let patched = 0;
for (const filePath of targets) {
  if (!fs.existsSync(filePath)) continue;
  let text = fs.readFileSync(filePath, "utf8");
  if (text.includes(MARKER)) continue;
  let applied = false;
  for (const { needle, replacement } of patches) {
    if (text.includes(needle)) {
      text = text.replace(needle, replacement);
      applied = true;
      break;
    }
  }
  if (!applied) {
    console.warn(`[patch-antd-modal-confirm] skip (pattern not found): ${path.relative(repoRoot, filePath)}`);
    continue;
  }
  fs.writeFileSync(filePath, text, "utf8");
  patched += 1;
}

if (patched > 0) {
  console.log(`[patch-antd-modal-confirm] patched ${patched} file(s).`);
}
