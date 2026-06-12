import type { AIChatInput } from "@douyinfe/semi-ui";
import {
  insertComposerCodeSelectionRef,
  type InsertComposerCodeSelectionRefResult,
} from "./insertComposerCodeSelectionRef";
import type { ComposerCodeSelectionRefAttrs } from "./composerCodeSelectionRefExtension";

const MAX_INSERT_ATTEMPTS = 10;

/** 编辑器未就绪时按帧重试，避免首次点击因 Tiptap 未挂载而失败。 */
export function scheduleInsertComposerCodeSelectionRef(
  aiChat: InstanceType<typeof AIChatInput> | null,
  attrs: ComposerCodeSelectionRefAttrs,
  onResult: (result: InsertComposerCodeSelectionRefResult) => void,
): void {
  let attempts = 0;
  const tryInsert = () => {
    const result = insertComposerCodeSelectionRef(aiChat, attrs);
    if (result !== "unavailable" || attempts >= MAX_INSERT_ATTEMPTS) {
      onResult(result);
      return;
    }
    attempts += 1;
    requestAnimationFrame(tryInsert);
  };
  tryInsert();
}
