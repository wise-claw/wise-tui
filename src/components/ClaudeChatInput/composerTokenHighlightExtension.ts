import { Mark, Extension } from "@tiptap/core";
import { composerCodeSelectionRefExtension } from "./composerCodeSelectionRefExtension";
import {
  createComposerHighlightMarkSyncPlugin,
  syncComposerHighlightMarksOnEditor,
} from "./composerTokenHighlight";

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

/** 仅挂载 mark-sync 插件；Mark 定义需与 Semi 内置扩展并列注册，避免 addExtensions 未进 schema。 */
export const composerTokenHighlightSyncExtension = Extension.create({
  name: "wiseComposerTokenHighlightSync",
  priority: 1000,
  addProseMirrorPlugins() {
    return [createComposerHighlightMarkSyncPlugin()];
  },
  onCreate() {
    queueMicrotask(() => {
      syncComposerHighlightMarksOnEditor(this.editor);
    });
  },
});

/** Semi AIChatInput 扩展 bundle：Mark + 高优先级 sync 插件 + Monaco 代码选区 pill。 */
export const composerTokenHighlightExtensions = [
  composerAtHighlightMark,
  composerSlashHighlightMark,
  composerCodeSelectionRefExtension,
  composerTokenHighlightSyncExtension,
];

/** @deprecated 使用 `composerTokenHighlightExtensions` */
export const composerTokenHighlightExtension = composerTokenHighlightSyncExtension;
