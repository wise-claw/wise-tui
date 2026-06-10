import { normalizeComposerEditorPlain } from "./composer-plain-utils";

/** setContent 异步执行前：若用户已在编辑器中继续输入，则不要用旧的 React plain 覆盖。 */
export function shouldSkipStaleComposerSetContent(
  editorPlain: string,
  targetPlain: string,
  editorFocused: boolean,
): boolean {
  if (!editorFocused) return false;

  const editor = normalizeComposerEditorPlain(editorPlain);
  const target = normalizeComposerEditorPlain(targetPlain);

  // 发送后清空等显式 setContent("") 必须生效，不能因 editor 仍聚焦而被误判为 stale。
  if (!target.length) return false;

  if (editor === target) return true;

  const targetStem = target.trimEnd();
  if (editor.length > target.length && (editor.startsWith(targetStem) || editor.startsWith(target))) {
    return true;
  }

  return false;
}
