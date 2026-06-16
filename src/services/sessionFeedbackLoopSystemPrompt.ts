import { listFeedbackLoopHistory } from "./sessionFeedbackLoopHistoryStore";
import { loadSessionFeedbackLoopState } from "./sessionFeedbackLoopStore";
import {
  buildFeedbackLoopHabitsPhraseText,
  extractFeedbackLoopHabits,
} from "../utils/sessionFeedbackLoop";

const MAX_HABITS = 6;

/** 合并多段 append system prompt，空段自动跳过。 */
export function mergeAppendSystemPromptParts(
  ...parts: Array<string | undefined | null>
): string | undefined {
  const merged = parts
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join("\n\n");
  return merged || undefined;
}

export function dedupeFeedbackLoopHabits(
  habits: readonly string[],
  max = MAX_HABITS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const habit of habits) {
    const trimmed = habit.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/** 聚合当前会话闭环与仓库历史沉淀的习惯（会话优先，历史补充）。 */
export function collectFeedbackLoopHabitsForRepository(input: {
  repositoryPath?: string | null;
  sessionId?: string | null;
}): string[] {
  const collected: string[] = [];
  const sessionId = input.sessionId?.trim();
  if (sessionId) {
    const state = loadSessionFeedbackLoopState(sessionId);
    if (state?.cycles.some((cycle) => cycle.comparison != null)) {
      collected.push(...extractFeedbackLoopHabits(state));
    }
  }

  const repositoryPath = input.repositoryPath?.trim();
  if (repositoryPath) {
    const latest = listFeedbackLoopHistory(repositoryPath)[0];
    if (latest?.habits?.length) {
      collected.push(...latest.habits);
    }
  }

  return dedupeFeedbackLoopHabits(collected);
}

/** 供 Claude CLI `--append-system-prompt` 使用的习惯块。 */
export function buildFeedbackLoopSystemPromptBlock(habits: readonly string[]): string | undefined {
  const body = buildFeedbackLoopHabitsPhraseText(habits);
  if (!body) return undefined;
  return [
    body,
    "请在后续工具调用中优先遵循以上习惯；若与当前任务冲突，以任务目标为准。",
  ].join("\n\n");
}

export function resolveFeedbackLoopSystemPromptAppend(input: {
  repositoryPath?: string | null;
  sessionId?: string | null;
}): string | undefined {
  const habits = collectFeedbackLoopHabitsForRepository(input);
  if (habits.length === 0) return undefined;
  return buildFeedbackLoopSystemPromptBlock(habits);
}
