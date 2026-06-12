import { Node, mergeAttributes } from "@tiptap/core";

export const COMPOSER_CODE_SELECTION_REF_NODE = "wiseCodeSelectionRef";

export interface ComposerCodeSelectionRefAttrs {
  path: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  selectedText: string;
  language: string;
}

export function formatCodeSelectionRefLabel(attrs: ComposerCodeSelectionRefAttrs): string {
  const filename = attrs.path.split(/[/\\]/).pop() || attrs.path;
  const lineLabel =
    attrs.startLine === attrs.endLine
      ? `(${attrs.startLine})`
      : `(${attrs.startLine}-${attrs.endLine})`;
  return `${filename} ${lineLabel}`;
}

function fileExtensionFromPath(path: string): string {
  const filename = path.split(/[/\\]/).pop() ?? path;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export const composerCodeSelectionRefExtension = Node.create({
  name: COMPOSER_CODE_SELECTION_REF_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      path: { default: "" },
      startLine: { default: 1 },
      endLine: { default: 1 },
      startChar: { default: 1 },
      endChar: { default: 1 },
      selectedText: { default: "" },
      language: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-wise-code-selection-ref]" }];
  },
  renderHTML({ node }) {
    const attrs = node.attrs as ComposerCodeSelectionRefAttrs;
    const label = formatCodeSelectionRefLabel(attrs);
    const preview = attrs.selectedText.replace(/\s+/g, " ").trim().slice(0, 120);
    return [
      "span",
      mergeAttributes({
        class: "wise-composer-code-selection-ref",
        "data-wise-code-selection-ref": "true",
        contenteditable: "false",
        "data-path": attrs.path,
        "data-file-ext": fileExtensionFromPath(attrs.path),
        "data-start-line": String(attrs.startLine),
        "data-end-line": String(attrs.endLine),
        "data-start-char": String(attrs.startChar),
        "data-end-char": String(attrs.endChar),
        "data-language": attrs.language,
        "data-selected-text": attrs.selectedText,
        title: preview ? `${label}\n${preview}` : label,
      }),
      label,
    ];
  },
});
