import { Mark, Extension } from "@tiptap/core";
import { createComposerHighlightMarkSyncPlugin } from "./composerTokenHighlight";

export const composerAtHighlightMark = Mark.create({
  name: "wiseComposerAtHighlight",
  inclusive: false,
  exitable: true,
  spanning: true,
  parseHTML() {
    return [{ tag: "span.app-composer-token-highlight--at" }];
  },
  renderHTML() {
    return [
      "span",
      {
        class: "app-composer-token-highlight app-composer-token-highlight--at",
        "data-wise-composer-highlight": "at",
      },
      0,
    ];
  },
});

export const composerSlashHighlightMark = Mark.create({
  name: "wiseComposerSlashHighlight",
  inclusive: false,
  exitable: true,
  spanning: true,
  parseHTML() {
    return [{ tag: "span.app-composer-token-highlight--slash" }];
  },
  renderHTML() {
    return [
      "span",
      {
        class: "app-composer-token-highlight app-composer-token-highlight--slash",
        "data-wise-composer-highlight": "slash",
      },
      0,
    ];
  },
});

/** Semi AIChatInput 扩展：用 document mark 持久 @ / 指令高亮（Decoration 在 Semi 输入链上会被冲掉）。 */
export const composerTokenHighlightExtension = Extension.create({
  name: "wiseComposerTokenHighlight",
  addExtensions() {
    return [composerAtHighlightMark, composerSlashHighlightMark];
  },
  addProseMirrorPlugins() {
    return [createComposerHighlightMarkSyncPlugin()];
  },
});
