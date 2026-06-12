import type { ComposerCodeSelectionRefAttrs } from "../components/ClaudeChatInput/composerCodeSelectionRefExtension";
import { buildMonacoSelectionComposerText } from "./buildMonacoSelectionComposerText";

/** 发送前将 composer 内折叠的代码选区 pill 展开为完整 Markdown 前缀。 */
export function expandComposerCodeSelectionRefs(
  plain: string,
  refs: ComposerCodeSelectionRefAttrs[],
): string {
  const blocks = refs
    .map((ref) =>
      buildMonacoSelectionComposerText({
        relativePath: ref.path,
        language: ref.language,
        selectedText: ref.selectedText,
        startLine: ref.startLine,
        endLine: ref.endLine,
      }),
    )
    .filter((block) => block.trim().length > 0);
  if (blocks.length === 0) return plain;
  const prefix = blocks.join("\n\n");
  const body = plain.trim();
  return body ? `${prefix}\n\n${body}` : prefix;
}
