import type { Editor } from "@tiptap/core";
import {
  COMPOSER_CODE_SELECTION_REF_NODE,
  type ComposerCodeSelectionRefAttrs,
} from "./composerCodeSelectionRefExtension";

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAttrs(raw: Record<string, unknown>): ComposerCodeSelectionRefAttrs | null {
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  const selectedText = typeof raw.selectedText === "string" ? raw.selectedText : "";
  if (!path || !selectedText.trim()) return null;
  return {
    path,
    selectedText,
    language: typeof raw.language === "string" ? raw.language : "",
    startLine: Math.max(1, readNumber(raw.startLine, 1)),
    endLine: Math.max(1, readNumber(raw.endLine, 1)),
    startChar: Math.max(1, readNumber(raw.startChar, 1)),
    endChar: Math.max(1, readNumber(raw.endChar, 1)),
  };
}

/** 从 Tiptap 文档提取所有代码选区 pill 的序列化属性。 */
export function extractComposerCodeSelectionRefs(editor: Editor | null | undefined): ComposerCodeSelectionRefAttrs[] {
  if (!editor) return [];
  const refs: ComposerCodeSelectionRefAttrs[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== COMPOSER_CODE_SELECTION_REF_NODE) return;
    const normalized = normalizeAttrs(node.attrs as Record<string, unknown>);
    if (normalized) refs.push(normalized);
  });
  return refs;
}
