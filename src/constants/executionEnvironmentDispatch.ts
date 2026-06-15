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
  gemini: SESSION_EXECUTION_ENGINE_LABELS.gemini.title,
  opencode: SESSION_EXECUTION_ENGINE_LABELS.opencode.title,
};

/** 左栏「任务派发」历史查询可选天数。 */
export const EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS = [1, 3, 5, 7] as const;

export type ExecutionEnvironmentDispatchHistoryDays =
  (typeof EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS)[number];

/** 持久化与内存 store 一次加载的最大历史窗口（避免切换天数时重复查库）。 */
export const MAX_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS = Math.max(
  ...EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS,
) as ExecutionEnvironmentDispatchHistoryDays;

export const DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS: ExecutionEnvironmentDispatchHistoryDays = 1;

export function normalizeExecutionEnvironmentDispatchHistoryDays(
  raw: unknown,
): ExecutionEnvironmentDispatchHistoryDays {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.includes(n as ExecutionEnvironmentDispatchHistoryDays)) {
    return n as ExecutionEnvironmentDispatchHistoryDays;
  }
  return DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS;
}

export function historyDaysToSinceMs(days: ExecutionEnvironmentDispatchHistoryDays, now = Date.now()): number {
  return now - days * 24 * 60 * 60 * 1000;
}

export function maxExecutionEnvironmentDispatchHistorySinceMs(now = Date.now()): number {
  return historyDaysToSinceMs(MAX_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS, now);
}
