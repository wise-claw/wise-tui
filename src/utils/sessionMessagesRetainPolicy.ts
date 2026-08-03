import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { isExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import { isFeedbackLoopWorkerRepositoryName } from "./sessionFeedbackLoopDispatch";

/**
 * 非活动时仍应保留内存正文的会话（全局预算 / 切标签清空例外）。
 *
 * `@Claude Code` 等已改为普通会话 + 标签级 `executionEngine`，不再依赖 `/执行环境:` 命名。
 */
export function sessionShouldRetainMessagesWhenInactive(session: {
  repositoryName?: string | null;
  executionEngine?: SessionExecutionEngine | null;
}): boolean {
  const name = session.repositoryName ?? "";
  if (isExecutionEnvironmentWorkerRepositoryName(name)) return true;
  if (isFeedbackLoopWorkerRepositoryName(name)) return true;
  if (session.executionEngine) return true;
  return false;
}
