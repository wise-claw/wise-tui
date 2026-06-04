import type { SessionExecutionEngine } from "./sessionExecutionEngine";
import { SESSION_EXECUTION_ENGINE_LABELS } from "./sessionExecutionEngine";

/** 兼容旧文案：`@执行环境` 视为 Claude Code 派发（不含 @ 前缀）。 */
export const EXECUTION_ENVIRONMENT_MENTION_NAME = "执行环境";

/** worker 标签 `repositoryName` 片段：`{repoDisplay}/执行环境:{engine}:{label}` */
export const EXECUTION_ENVIRONMENT_REPO_MARKER = "/执行环境:";

/** @ 补全插入与解析用的引擎 mention（不含 @ 前缀）。 */
export const EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES: Record<SessionExecutionEngine, string> = {
  claude: SESSION_EXECUTION_ENGINE_LABELS.claude.title,
  codex: SESSION_EXECUTION_ENGINE_LABELS.codex.title,
  cursor: SESSION_EXECUTION_ENGINE_LABELS.cursor.title,
};
