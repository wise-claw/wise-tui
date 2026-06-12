import type { ComposerCodeSelectionRefAttrs } from "../components/ClaudeChatInput/composerCodeSelectionRefExtension";

export type CodeSelectionRefIdentity = Pick<
  ComposerCodeSelectionRefAttrs,
  "path" | "startLine" | "endLine" | "startChar" | "endChar"
>;

/** 用于 composer 内代码选区 pill 去重的稳定键。 */
export function codeSelectionRefKey(ref: CodeSelectionRefIdentity): string {
  const path = ref.path.trim();
  return `${path}:${ref.startLine}:${ref.startChar}-${ref.endLine}:${ref.endChar}`;
}

export function isSameCodeSelectionRef(
  left: CodeSelectionRefIdentity,
  right: CodeSelectionRefIdentity,
): boolean {
  return codeSelectionRefKey(left) === codeSelectionRefKey(right);
}
