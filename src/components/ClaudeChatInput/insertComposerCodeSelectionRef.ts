import type { AIChatInput } from "@douyinfe/semi-ui";
import {
  COMPOSER_CODE_SELECTION_REF_NODE,
  type ComposerCodeSelectionRefAttrs,
} from "./composerCodeSelectionRefExtension";
import { extractComposerCodeSelectionRefs } from "./extractComposerCodeSelectionRefs";
import { isSameCodeSelectionRef } from "../../utils/codeSelectionRefKey";

export type InsertComposerCodeSelectionRefResult = "inserted" | "duplicate" | "unavailable";

type TiptapChain = {
  focus: (pos?: string) => TiptapChain;
  insertContent: (value: unknown) => TiptapChain;
  run: () => void;
};

function readComposerPlain(aiChat: InstanceType<typeof AIChatInput> | null): string {
  const editor = aiChat?.getEditor?.() as { getText?: (opts?: { blockSeparator?: string }) => string } | undefined;
  if (!editor?.getText) return "";
  try {
    return (editor.getText({ blockSeparator: "\n" }) ?? "").replace(/[\u200B\uFEFF]/g, "");
  } catch {
    return "";
  }
}

/** 在 Semi composer 末尾插入折叠的代码选区 pill。 */
export function insertComposerCodeSelectionRef(
  aiChat: InstanceType<typeof AIChatInput> | null,
  attrs: ComposerCodeSelectionRefAttrs,
): InsertComposerCodeSelectionRefResult {
  const editor = aiChat?.getEditor?.() as { chain?: () => TiptapChain } | undefined;
  if (!editor?.chain || !attrs.path.trim() || !attrs.selectedText.trim()) return "unavailable";

  const existing = extractComposerCodeSelectionRefs(
    aiChat?.getEditor?.() as import("@tiptap/core").Editor | null | undefined,
  );
  if (existing.some((ref) => isSameCodeSelectionRef(ref, attrs))) return "duplicate";

  const plain = readComposerPlain(aiChat);
  const needsLeadingSpace = plain.trim().length > 0 && !/\s$/.test(plain);

  let chain = editor.chain().focus("end");
  if (needsLeadingSpace) {
    chain = chain.insertContent(" ");
  }
  chain
    .insertContent({
      type: COMPOSER_CODE_SELECTION_REF_NODE,
      attrs,
    })
    .insertContent(" ")
    .run();
  return "inserted";
}
