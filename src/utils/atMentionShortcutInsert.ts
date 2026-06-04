import type { AtMentionDefaultTarget } from "../constants/atMentionDefault";
import { EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES } from "../constants/executionEnvironmentDispatch";

/** 插入会话输入框的 @ 提及文本（不含尾部空格）。 */
export function atMentionInsertionText(target: AtMentionDefaultTarget): string {
  if (target.kind === "terminal") {
    return `@${target.employeeName.trim()}`;
  }
  return `@${EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES[target.engine]}`;
}
