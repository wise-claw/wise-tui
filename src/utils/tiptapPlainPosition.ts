import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

/**
 * 读取 doc 的 plain 文本：与 `editor.getText()`（blockSeparator="\n"）语义一致，
 * 作为 @ 提及 / / 命令补全的纯文本工作模型。
 */
export function tiptapDocPlainText(doc: Node): string {
  return doc.textBetween(0, doc.content.size, "\n");
}

/** doc 位置 → plain 偏移：直接复用 `textBetween(0, pos, "\n")` 长度。 */
export function docPositionToPlainOffset(doc: Node, pos: number): number {
  return doc.textBetween(0, pos, "\n").length;
}

/**
 * plain 偏移 → doc 位置。镜像 `doc.textBetween(0, size, "\n")` 的算法：
 * - 文本节点按字符计数；
 * - textblock（段落/标题/代码块等）与带 `leafText` 的 leaf block 之间插入一个 "\n"；
 * - 其余 leaf（图片 / 硬换行等）不占 plain 字符、只占 doc 位置。
 * 用于在富文本 doc 上做精确增量编辑（@ 提及 / / 命令），避免整篇 setContent 破坏 markdown 格式。
 */
export function plainOffsetToDocPosition(doc: Node, plainOffset: number): number {
  const size = doc.content.size;
  if (plainOffset <= 0) return 0;
  let chars = 0;
  let first = true;
  let result = -1;
  doc.nodesBetween(0, size, (node, pos) => {
    if (result >= 0) return false;
    if (node.isText) {
      const text = node.text ?? "";
      const next = chars + text.length;
      if (plainOffset <= next) {
        result = pos + Math.max(0, plainOffset - chars);
        return false;
      }
      chars = next;
      return;
    }
    if (node.isBlock && (node.isTextblock || (node.isLeaf && node.type.spec.leafText))) {
      if (first) {
        first = false;
      } else {
        chars += 1;
      }
    }
  });
  if (result >= 0) return result;
  return size;
}

/**
 * 在 Tiptap 编辑器上按 plain 文本差异做增量编辑：
 * 计算当前 plain 与目标 plain 的公共前缀 / 后缀，仅替换中间片段。
 * 补全插入均为单行片段（@提及 / /命令），不会跨块，因此安全性成立。
 */
export function applyTiptapPlainEdit(editor: Editor, nextPlain: string): void {
  const doc = editor.state.doc;
  const current = tiptapDocPlainText(doc);
  if (nextPlain === current) {
    editor.commands.focus();
    return;
  }
  const maxCommon = Math.min(current.length, nextPlain.length);
  let prefix = 0;
  while (prefix < maxCommon && current.charCodeAt(prefix) === nextPlain.charCodeAt(prefix)) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === nextPlain.charCodeAt(nextPlain.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const from = plainOffsetToDocPosition(doc, prefix);
  const to = plainOffsetToDocPosition(doc, current.length - suffix);
  const middle = nextPlain.slice(prefix, nextPlain.length - suffix);
  if (!middle) {
    editor.chain().focus().deleteRange({ from, to }).run();
    return;
  }
  // 用 JSON 文本节点插入：不经过 HTML 解析，保留空格 / @ 等原样，光标自动落在插入内容末尾。
  editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .insertContent({ type: "text", text: middle })
    .run();
}
