import type { BackgroundInvocationSnapshot } from "../services/backgroundInvocationSnapshot";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import type { ClaudeMessage, ClaudeSession, MessagePart, SessionConversationTaskItem, ToolUsePart } from "../types";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../constants/sessionExecutionEngine";
import type { ExecutionEnvironmentDispatchRecord } from "../stores/executionEnvironmentDispatchStore";
import { sessionStatusToConversationTaskStatus } from "../stores/executionEnvironmentDispatchStore";
import { indexOfLastRenderableUserMessage, isToolOnlyUserMessage, isAssistantDisplayNoiseText, parseDispatchRecordDisplayTimeMs, type DispatchRecordMeta } from "./claudeChatMessageDisplay";
import { isExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import { resolveSessionExecutionEngine, sessionHasDiskTranscript } from "./sessionExecutionEngine";
import {
  findExecutionEnvironmentWorkerForTaskDetail,
} from "./sessionExecuteResolve";
import { isOmcDirectBatchInvocationRunning } from "./omcDirectBatchInvocationDisplay";
import { formatChatMessageListTime } from "./formatChatMessageListTime";
import { assistantMessageVisiblePlainText } from "../services/claudeSessionState";

export { formatChatMessageListTime as formatExecutionEnvironmentDispatchTaskTime };

/** 执行环境派发保存时间：运行面板展示，不含年份（M/D HH:mm:ss）。 */
export function formatExecutionEnvironmentDispatchSavedTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 主会话当前轮次工具任务；流式正文按长度分桶，避免每 token 重算任务列表。 */
export function anchorSessionConversationTasksFingerprint(
  session: ClaudeSession | null | undefined,
): string {
  if (!session) return "";
  const turnMessages = messagesForCurrentConversationTurn(session.messages);
  const toolSig: string[] = [];
  for (const part of mergeToolUseParts(turnMessages)) {
    if (!isConversationTaskTool(part)) continue;
    toolSig.push(
      `${part.id}:${part.name}:${(part.output?.length ?? 0) + (part.error?.length ?? 0)}`,
    );
  }
  return [
    session.id,
    session.status,
    String(currentConversationTurnStartTimestamp(session.messages)),
    String(turnMessages.length),
    toolSig.join(","),
  ].join("|");
}

/** 派发任务列表关心执行环境 worker 会话；主会话流式正文不在此指纹内。 */
export function executionEnvironmentWorkerSessionsFingerprint(
  sessions: readonly ClaudeSession[],
): string {
  const chunks: string[] = [];
  for (const session of sessions) {
    if (!isExecutionEnvironmentWorkerRepositoryName(session.repositoryName)) continue;
    const last = session.messages[session.messages.length - 1];
    chunks.push(
      [
        session.id,
        session.status,
        String(session.messages.length),
        String(last?.id ?? ""),
        String(last?.content?.length ?? 0),
      ].join("|"),
    );
  }
  return chunks.join("\n");
}

function truncate(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

/** 运行面板终端/派发行：助手摘要截断上限（CSS 仍会在侧栏宽度内 ellipsis）。 */
export const MONITOR_ROW_RESULT_PREVIEW_MAX = 120;

function truncateMonitorRowPreview(text: string): string {
  return truncate(text, MONITOR_ROW_RESULT_PREVIEW_MAX);
}

function readInputString(input: ToolUsePart["input"], keys: string[]): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function isConversationTaskTool(part: ToolUsePart): boolean {
  const name = part.name.trim().toLowerCase();
  if (
    name === "task" ||
    name === "agent" ||
    name.includes("subagent") ||
    name === "spawn_agent" ||
    name === "run_subagent"
  ) {
    return true;
  }

  const description = readInputString(part.input, ["description", "title", "summary"]);
  const prompt = readInputString(part.input, ["prompt", "instructions"]);
  if (/子\s*代理|subagent/i.test(description) || /子\s*代理|subagent/i.test(prompt)) {
    return true;
  }

  if (name === "bash" || name === "shell" || name === "run_terminal_cmd" || name === "exec") {
    if (part.input && typeof part.input === "object") {
      const record = part.input as Record<string, unknown>;
      if (record.run_in_background === true || record.runInBackground === true) return true;
    }
    if (/timer|后台|background/i.test(description)) return true;
  }
  return false;
}

function mergeToolStatus(prev: ToolUsePart, next: ToolUsePart): ToolUsePart["status"] {
  const output = next.output?.trim() ? next.output : prev.output;
  const error = next.error?.trim() ? next.error : prev.error;
  if (next.status === "error" || prev.status === "error" || error?.trim()) return "error";
  if (output?.trim()) return "completed";
  if (next.status === "completed" || prev.status === "completed") return "completed";
  if (
    next.status === "running" ||
    prev.status === "running" ||
    next.status === "pending" ||
    prev.status === "pending"
  ) {
    return "running";
  }
  return "completed";
}

function mergeToolUseParts(messages: ClaudeSession["messages"]): ToolUsePart[] {
  const byId = new Map<string, ToolUsePart>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool_use" || !part.id.trim()) continue;
      const prev = byId.get(part.id);
      if (!prev) {
        byId.set(part.id, part);
        continue;
      }
      byId.set(part.id, {
        ...prev,
        ...part,
        name: prev.name.trim() ? prev.name : part.name,
        input: Object.keys(prev.input ?? {}).length > 0 ? prev.input : part.input,
        output: part.output?.trim() ? part.output : prev.output,
        error: part.error?.trim() ? part.error : prev.error,
        status: mergeToolStatus(prev, part),
      });
    }
  }
  return [...byId.values()];
}

function labelFromToolPart(part: ToolUsePart): { label: string; subtitle?: string } {
  const name = part.name.trim();
  const nameLower = name.toLowerCase();
  const subagentType = readInputString(part.input, ["subagent_type", "agent_type", "type"]);
  const description = readInputString(part.input, ["description", "title", "summary"]);
  const prompt = readInputString(part.input, ["prompt", "instructions"]);
  if (subagentType) {
    return { label: subagentType, subtitle: description ? truncate(description, 48) : undefined };
  }
  if (description) {
    return {
      label: truncate(description, 56) || name || "子代理",
      subtitle: nameLower === "task" || nameLower === "agent" ? name : name || undefined,
    };
  }
  if (prompt) {
    return {
      label: truncate(prompt, 56),
      subtitle: name || undefined,
    };
  }
  return { label: name || "Task" };
}

function hasSettledAfterToolUse(messages: ClaudeSession["messages"], toolId: string): boolean {
  let found = false;
  for (const message of messages) {
    if (!found) {
      if (message.parts.some((part) => part.type === "tool_use" && part.id === toolId)) {
        found = true;
      }
      continue;
    }
    if (message.role === "user") {
      const result = message.parts.find(
        (part): part is ToolUsePart => part.type === "tool_use" && part.id === toolId,
      );
      if (result?.output?.trim() || result?.status === "completed" || result?.status === "error") {
        return true;
      }
    }
    if (message.role === "assistant") {
      const hasText = message.parts.some(
        (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
      );
      if (hasText) return true;
    }
  }
  return false;
}

function resolveConversationTaskToolStatus(
  part: ToolUsePart,
  messages: ClaudeSession["messages"],
  sessionStatus?: ClaudeSession["status"],
): SessionConversationTaskItem["status"] | null {
  const merged = mergeToolUseParts(messages).find((item) => item.id === part.id);
  if (merged?.status === "error" || merged?.error?.trim()) return "failed";
  if (merged?.status === "completed" || merged?.output?.trim()) return "completed";
  if (part.status === "error" || part.error?.trim()) return "failed";
  if (part.status === "completed" || part.output?.trim()) return "completed";
  if (part.status === "pending" || part.status === "running") {
    if (sessionStatus === "cancelled" || sessionStatus === "error") return "failed";
    if (hasSettledAfterToolUse(messages, part.id)) return "completed";
    if (sessionStatus === "idle" && merged?.output?.trim()) {
      return "completed";
    }
    return "running";
  }
  return null;
}

function invocationStatus(inv: WorkflowInvocationStreamDetail): SessionConversationTaskItem["status"] | null {
  if (isOmcDirectBatchInvocationRunning(inv) || inv.phase === "started" || inv.phase === "progress") {
    return "running";
  }
  if (inv.phase === "complete") {
    return inv.success === false ? "failed" : "completed";
  }
  return null;
}

function labelFromInvocation(inv: WorkflowInvocationStreamDetail): string {
  const fromTitle = inv.taskTitle?.trim();
  if (fromTitle) return fromTitle;
  const type = inv.subagentType?.trim();
  if (type) return type;
  if (inv.taskId?.trim()) return `任务 ${inv.taskId.trim()}`;
  if (inv.templateId?.trim()) return inv.templateId.trim();
  const preview = inv.previewLine?.trim();
  if (preview) return truncate(preview, 56);
  return "后台任务";
}

function snapshotStatus(snap: BackgroundInvocationSnapshot): SessionConversationTaskItem["status"] {
  if (snap.phase === "running") return "running";
  return snap.success === false ? "failed" : "completed";
}

export function invocationBelongsToSession(inv: WorkflowInvocationStreamDetail, session: ClaudeSession): boolean {
  const sid = inv.sessionId?.trim();
  if (!sid) return false;
  return sid === session.id || sid === session.claudeSessionId?.trim();
}

/** 当前对话轮次：自最后一条可展示用户消息起（新会话 / 新一轮输入后仅统计本轮子代理与任务）。 */
export function messagesForCurrentConversationTurn(
  messages: ClaudeSession["messages"],
): ClaudeSession["messages"] {
  const startIdx = indexOfLastRenderableUserMessage(messages);
  if (startIdx < 0) return messages;
  return messages.slice(startIdx);
}

export function currentConversationTurnStartTimestamp(messages: ClaudeSession["messages"]): number {
  const startIdx = indexOfLastRenderableUserMessage(messages);
  if (startIdx < 0) return 0;
  return messages[startIdx]?.timestamp ?? 0;
}

/** 派发轮次内是否存在可展示的助手正文（排除占位句）。 */
export function workerHasMeaningfulAssistantReplyAfterDispatch(worker: ClaudeSession): boolean {
  const turnStart = indexOfLastRenderableUserMessage(worker.messages);
  if (turnStart < 0) return false;
  for (let i = turnStart + 1; i < worker.messages.length; i += 1) {
    const msg = worker.messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = assistantMessageVisiblePlainText(msg);
    if (text.trim() && !isAssistantDisplayNoiseText(text)) return true;
  }
  return false;
}

/** 派发轮次内最后一条可展示助手正文（运行面板终端/派发行摘要）。 */
export function resolveWorkerDispatchTurnLastAssistantPreview(
  worker: ClaudeSession | null | undefined,
): string {
  if (!worker) return "";
  const turnStart = indexOfLastRenderableUserMessage(worker.messages);
  if (turnStart < 0) return "";
  let lastText = "";
  for (let i = turnStart + 1; i < worker.messages.length; i += 1) {
    const msg = worker.messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = assistantMessageVisiblePlainText(msg);
    if (text.trim() && !isAssistantDisplayNoiseText(text)) {
      lastText = text;
    }
  }
  return truncateMonitorRowPreview(lastText);
}

function workerLastTurnHasTrailingActivity(worker: ClaudeSession, lastUserIdx: number): boolean {
  return lastUserIdx >= 0 && lastUserIdx < worker.messages.length - 1;
}

/** 派发 worker 是否需要从磁盘拉回完整 jsonl（侧栏状态 / 详情 drawer 依赖正文）。 */
export function executionEnvironmentWorkerNeedsTranscriptHydration(
  worker: ClaudeSession | null | undefined,
): boolean {
  if (!worker || !isExecutionEnvironmentWorkerRepositoryName(worker.repositoryName)) {
    return false;
  }
  if (worker.status === "running" || worker.status === "connecting") return false;
  if (!worker.claudeSessionId?.trim()) return true;
  if (worker.messages.length === 0) return true;
  if (worker.diskTranscriptPartial) return true;
  if (!worker.transcriptMemoryUnlimited) return true;
  return false;
}

/** 当前 anchor 下需要从磁盘预加载正文的派发 worker tab id（去重）。 */
export function listExecutionEnvironmentWorkerIdsNeedingTranscriptHydration(
  sessions: readonly ClaudeSession[],
  dispatchRecords: readonly ExecutionEnvironmentDispatchRecord[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const batch of dispatchRecords) {
    for (const item of batch.items) {
      const workerId = item.workerSessionId.trim();
      if (!workerId || seen.has(workerId)) continue;
      seen.add(workerId);
      const worker = findExecutionEnvironmentWorkerForTaskDetail(sessions, {
        workerSessionId: workerId,
        repositoryPath: batch.repositoryPath,
      });
      if (!worker || !executionEnvironmentWorkerNeedsTranscriptHydration(worker)) continue;
      const engine = resolveSessionExecutionEngine(worker, [], []);
      if (!sessionHasDiskTranscript(worker, engine)) continue;
      out.push(worker.id);
    }
  }
  return out;
}

/**
 * 执行环境 worker 任务态：按**最后一轮**用户消息后的结果推断，不用会话级 status 的历史残留。
 * Host 可能因 Hook/oneshot 退出码标 error/cancelled，但最后一轮已有助手正文时仍按已完成展示。
 */
export function resolveExecutionEnvironmentWorkerConversationTaskStatus(
  worker: ClaudeSession | null | undefined,
): SessionConversationTaskItem["status"] {
  if (!worker) return "completed";
  if (worker.status === "running" || worker.status === "connecting") return "running";

  const lastUserIdx = indexOfLastRenderableUserMessage(worker.messages);
  if (lastUserIdx < 0) {
    return sessionStatusToConversationTaskStatus(worker.status);
  }

  if (workerHasMeaningfulAssistantReplyAfterDispatch(worker)) {
    return "completed";
  }

  // 最后一轮尚无助手回复：以本轮执行结果为准，忽略上一轮遗留的 completed。
  if (worker.status === "error" || worker.status === "cancelled") {
    return "failed";
  }

  if (workerLastTurnHasTrailingActivity(worker, lastUserIdx)) {
    return "failed";
  }

  return sessionStatusToConversationTaskStatus(worker.status);
}

export function buildExecutionEnvironmentConversationTasks(input: {
  anchorSession: ClaudeSession | null | undefined;
  sessions: readonly ClaudeSession[];
  dispatchRecords: readonly ExecutionEnvironmentDispatchRecord[];
}): SessionConversationTaskItem[] {
  const anchor = input.anchorSession;
  if (!anchor) return [];
  const anchorId = anchor.id.trim();
  const out: SessionConversationTaskItem[] = [];
  for (const batch of input.dispatchRecords) {
    if (batch.anchorSessionId !== anchorId) continue;
    const batchItems =
      batch.items.length > 0
        ? batch.items
        : [
            {
              key: `exec-env:${batch.batchId}:batch`,
              batchId: batch.batchId,
              anchorSessionId: batch.anchorSessionId,
              workerSessionId: `rehydrated:${batch.batchId}`,
              label: "任务",
              previewText: batch.previewText?.trim() || "已派发任务",
              batchIndex: 1,
              sessionCount: batch.sessionCount ?? 1,
              updatedAt: batch.createdAt,
            },
          ];
    for (const item of batchItems) {
      const repoPath = batch.repositoryPath || anchor.repositoryPath;
      const worker =
        findExecutionEnvironmentWorkerForTaskDetail(input.sessions, {
          workerSessionId: item.workerSessionId,
          repositoryPath: repoPath,
        }) ??
        input.sessions.find((s) => s.id === item.workerSessionId) ??
        input.sessions.find((s) => s.claudeSessionId?.trim() === item.workerSessionId);
      const status = worker
        ? resolveExecutionEnvironmentWorkerConversationTaskStatus(worker)
        : ("completed" as const);
      const assistantPreview = worker ? resolveWorkerDispatchTurnLastAssistantPreview(worker) : "";
      const dispatchedAt = item.updatedAt > 0 ? item.updatedAt : batch.createdAt;
      const engineShort = SESSION_EXECUTION_ENGINE_LABELS[batch.executionEngine].short;
      const promptBody = item.previewText?.replace(/\s+/g, " ").trim();
      const preview =
        status === "running"
          ? "执行中…"
          : assistantPreview || truncate(promptBody || "已完成");
      const label =
        promptBody.length > 0
          ? item.sessionCount > 1
            ? truncate(`${promptBody} (${item.batchIndex}/${item.sessionCount})`, 48)
            : truncate(promptBody, 48)
          : item.label;
      out.push({
        key: item.key,
        label,
        subtitle:
          item.sessionCount > 1
            ? `${engineShort} · ${item.batchIndex}/${item.sessionCount}`
            : engineShort,
        status,
        previewText: truncate(preview || promptBody || "执行中…"),
        updatedAt: dispatchedAt,
        source: "execution_environment",
        sessionId: item.workerSessionId,
        repositoryPath: batch.repositoryPath || anchor.repositoryPath,
        dispatchBatchId: item.batchId,
        batchIndex: item.batchIndex,
        batchSessionCount: item.sessionCount,
        cancellable: status === "running",
        cancelMode: status === "running" ? "session" : undefined,
      });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 左栏「任务派发」：仅展示执行环境派发历史，按更新时间倒序；可选 sinceMs 做展示窗口过滤。 */
export function filterExecutionEnvironmentDispatchTaskItems(
  items: readonly SessionConversationTaskItem[],
  sinceMs?: number,
): SessionConversationTaskItem[] {
  return [...items]
    .filter((item) => {
      if (item.source !== "execution_environment") return false;
      if (sinceMs == null) return true;
      return item.updatedAt >= sinceMs;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeDispatchContentForMatch(raw: string | undefined): string {
  const trimmed = raw?.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed === "（无正文）" || trimmed === "（无）") return "";
  return trimmed;
}

function executionEnvironmentEngineMatchesTask(
  meta: DispatchRecordMeta,
  task: SessionConversationTaskItem,
): boolean {
  const engine = meta.engineName?.trim() || meta.targetName?.trim();
  if (!engine) return true;
  const subtitle = task.subtitle?.trim() ?? "";
  if (!subtitle) return true;
  return subtitle.includes(engine) || engine.includes(subtitle.split(" · ")[0] ?? subtitle);
}

function pickExecutionEnvironmentBatchTask(
  tasks: readonly SessionConversationTaskItem[],
): SessionConversationTaskItem | null {
  if (tasks.length === 0) return null;
  return [...tasks].sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0))[0] ?? null;
}

/** 仅跟踪执行环境 worker 会话的运行态/消息长度，避免主会话每条流式消息触发任务列表重算。 */
export function digestWorkerSessionsForExecutionEnvironmentTasks(
  sessionsById: ReadonlyMap<string, ClaudeSession>,
  dispatchRecords: readonly ExecutionEnvironmentDispatchRecord[],
): string {
  if (dispatchRecords.length === 0) return "";
  const parts: string[] = [];
  for (const batch of dispatchRecords) {
    for (const item of batch.items) {
      const workerId = item.workerSessionId.trim();
      if (!workerId) continue;
      const session = sessionsById.get(workerId);
      if (!session) {
        parts.push(workerId, "missing");
        continue;
      }
      parts.push(session.id);
      parts.push(session.status);
      parts.push(String(session.messages.length));
      parts.push(String(indexOfLastRenderableUserMessage(session.messages)));
      const last = session.messages[session.messages.length - 1];
      parts.push(last?.role ?? "");
      parts.push(String(last?.id ?? ""));
    }
  }
  return parts.join("|");
}

/** 仅索引派发 worker 相关会话，避免主会话流式更新时全量 sessions 建 Map。 */
export function indexDispatchWorkerSessions(
  sessions: readonly ClaudeSession[],
  dispatchRecords: readonly ExecutionEnvironmentDispatchRecord[],
): Map<string, ClaudeSession> {
  const neededIds = new Set<string>();
  for (const batch of dispatchRecords) {
    for (const item of batch.items) {
      const workerId = item.workerSessionId.trim();
      if (workerId) neededIds.add(workerId);
    }
  }
  const map = new Map<string, ClaudeSession>();
  if (neededIds.size === 0) return map;

  const foundIds = new Set<string>();
  for (const session of sessions) {
    if (neededIds.has(session.id)) {
      map.set(session.id, session);
      foundIds.add(session.id);
    }
    const claudeSessionId = session.claudeSessionId?.trim();
    if (claudeSessionId && neededIds.has(claudeSessionId)) {
      map.set(claudeSessionId, session);
      foundIds.add(claudeSessionId);
    }
    if (foundIds.size >= neededIds.size) break;
  }
  return map;
}

/** 执行会话 drawer：仅当 worker 消息/状态变化时更新视图 digest。 */
export function digestSessionConversationTaskTranscript(
  task: SessionConversationTaskItem,
  session: ClaudeSession | null,
): string {
  if (!session) return `${task.key}|missing|${task.status}|${task.updatedAt}`;
  const last = session.messages[session.messages.length - 1];
  const lastTextLen =
    typeof last?.content === "string" ? last.content.length : String(last?.content ?? "").length;
  return [
    task.key,
    task.status,
    task.updatedAt,
    session.id,
    session.status,
    session.messages.length,
    last?.role ?? "",
    String(last?.id ?? ""),
    String(lastTextLen),
    session.claudeSessionId?.trim() ?? "",
    session.transcriptMemoryUnlimited ? "1" : "0",
  ].join("|");
}

/** 在已构建的任务列表上解析派发系统气泡（消息列表热路径，避免重复 build）。 */
export function resolveExecutionEnvironmentTaskFromTaskItems(
  meta: DispatchRecordMeta,
  tasks: readonly SessionConversationTaskItem[],
): SessionConversationTaskItem | null {
  if (meta.dispatchType?.trim() !== "执行环境") return null;
  if (tasks.length === 0) return null;

  const batchId = meta.dispatchBatchId?.trim();
  if (batchId) {
    return pickExecutionEnvironmentBatchTask(tasks.filter((item) => item.dispatchBatchId === batchId));
  }

  const content = normalizeDispatchContentForMatch(meta.dispatchContent);
  const timeMs = parseDispatchRecordDisplayTimeMs(meta.dispatchTime);
  const candidates = tasks.filter((item) => executionEnvironmentEngineMatchesTask(meta, item));
  if (content) {
    const byContent = candidates.filter((item) => {
      const label = item.label.replace(/\s+/g, " ").trim();
      const preview = item.previewText?.replace(/\s+/g, " ").trim() ?? "";
      return label === content || preview === content || label.startsWith(content);
    });
    if (byContent.length === 1) return byContent[0] ?? null;
    if (byContent.length > 1) {
      if (timeMs == null) return null;
      return (
        [...byContent].sort(
          (a, b) => Math.abs(a.updatedAt - timeMs) - Math.abs(b.updatedAt - timeMs),
        )[0] ?? null
      );
    }
  }

  if (timeMs != null) {
    const pool = candidates.length > 0 ? candidates : tasks;
    const nearest = [...pool].sort(
      (a, b) => Math.abs(a.updatedAt - timeMs) - Math.abs(b.updatedAt - timeMs),
    )[0];
    if (nearest && Math.abs(nearest.updatedAt - timeMs) <= 60_000) {
      return nearest;
    }
  }

  return null;
}

/** 主会话派发系统气泡 → 侧栏同源的执行环境任务项（用于点击打开详情 drawer）。 */
export function resolveExecutionEnvironmentTaskFromDispatchMeta(
  meta: DispatchRecordMeta,
  input: {
    anchorSession: ClaudeSession;
    sessions: readonly ClaudeSession[];
    dispatchRecords: readonly ExecutionEnvironmentDispatchRecord[];
  },
): SessionConversationTaskItem | null {
  const tasks = buildExecutionEnvironmentConversationTasks({
    anchorSession: input.anchorSession,
    sessions: input.sessions,
    dispatchRecords: input.dispatchRecords,
  });
  return resolveExecutionEnvironmentTaskFromTaskItems(meta, tasks);
}

export function buildSessionConversationTasks(input: {
  session: ClaudeSession | null | undefined;
  directBatchInvocations?: readonly WorkflowInvocationStreamDetail[];
  repositoryInvocations?: readonly WorkflowInvocationStreamDetail[];
  bundleSnapshots?: readonly BackgroundInvocationSnapshot[];
  executionEnvironmentRecords?: readonly ExecutionEnvironmentDispatchRecord[];
  allSessions?: readonly ClaudeSession[];
}): SessionConversationTaskItem[] {
  const session = input.session;
  if (!session) return [];

  const turnMessages = messagesForCurrentConversationTurn(session.messages);
  const turnStartedAt = currentConversationTurnStartTimestamp(session.messages);

  const merged = new Map<string, SessionConversationTaskItem>();

  function upsert(item: SessionConversationTaskItem) {
    const existing = merged.get(item.key);
    if (!existing) {
      merged.set(item.key, item);
      return;
    }
    const rank = (status: SessionConversationTaskItem["status"]) =>
      status === "running" ? 3 : status === "failed" ? 2 : 1;
    if (rank(item.status) > rank(existing.status) || item.updatedAt >= existing.updatedAt) {
      merged.set(item.key, { ...existing, ...item });
    }
  }

  for (const part of mergeToolUseParts(turnMessages)) {
    if (!isConversationTaskTool(part)) continue;
    const status = resolveConversationTaskToolStatus(part, session.messages, session.status);
    if (!status) continue;
    const { label, subtitle } = labelFromToolPart(part);
    const preview =
      part.output?.trim() ||
      part.error?.trim() ||
      subtitle ||
      (status === "running" ? "执行中…" : "已完成");
    upsert({
      key: `tool:${part.id}`,
      label,
      subtitle,
      status,
      previewText: truncate(preview),
      updatedAt: turnMessages.find((message) =>
        message.parts.some((item) => item.type === "tool_use" && item.id === part.id),
      )?.timestamp ?? Date.now(),
      source: "message_tool",
      toolUseId: part.id,
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      cancellable: status === "running",
      cancelMode: status === "running" ? "session" : undefined,
    });
  }

  const invocations = [
    ...(input.directBatchInvocations ?? []),
    ...(input.repositoryInvocations ?? []),
  ].filter((inv) => invocationBelongsToSession(inv, session));

  for (const inv of invocations) {
    const status = invocationStatus(inv);
    if (!status) continue;
    upsert({
      key: `inv:${inv.invocationKey}`,
      label: labelFromInvocation(inv),
      subtitle: inv.stage?.trim() || undefined,
      status,
      previewText: truncate(inv.previewLine?.trim() || inv.dispatchPrompt?.trim() || labelFromInvocation(inv)),
      updatedAt: Date.now(),
      source: "invocation_stream",
      invocationKey: inv.invocationKey,
      sessionId: session.id,
      repositoryPath: inv.repositoryPath?.trim() || session.repositoryPath,
      cancellable: status === "running" && Boolean(inv.invocationKey?.trim()),
      cancelMode: status === "running" && inv.invocationKey?.trim() ? "invocation" : undefined,
    });
  }

  if (input.executionEnvironmentRecords?.length && input.allSessions) {
    for (const item of buildExecutionEnvironmentConversationTasks({
      anchorSession: session,
      sessions: input.allSessions,
      dispatchRecords: input.executionEnvironmentRecords,
    })) {
      upsert(item);
    }
  }

  for (const snap of input.bundleSnapshots ?? []) {
    const status = snapshotStatus(snap);
    if (status !== "running" && turnStartedAt > 0 && snap.updatedAt < turnStartedAt) {
      continue;
    }
    upsert({
      key: `bundle:${snap.invocationKey}`,
      label: snap.taskId?.trim() ? `任务 ${snap.taskId.trim()}` : snap.templateId?.trim() || "后台任务",
      subtitle: snap.templateId?.trim() || undefined,
      status,
      previewText: truncate(snap.previewLine?.trim() || snap.dispatchPrompt?.trim() || "后台执行"),
      updatedAt: snap.updatedAt,
      source: "background_snapshot",
      invocationKey: snap.invocationKey,
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      cancellable: status === "running" && Boolean(snap.invocationKey?.trim()),
      cancelMode: status === "running" && snap.invocationKey?.trim() ? "invocation" : undefined,
    });
  }

  return [...merged.values()]
    .filter((item) => item.status === "running" || item.status === "completed" || item.status === "failed")
    .sort((a, b) => {
      const rank = (status: SessionConversationTaskItem["status"]) => (status === "running" ? 1 : 0);
      const dr = rank(b.status) - rank(a.status);
      if (dr !== 0) return dr;
      return b.updatedAt - a.updatedAt;
    });
}

export function sessionConversationTaskStatusLabel(status: SessionConversationTaskItem["status"]): string {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "已完成";
}

export function canStopSessionConversationTask(
  item: SessionConversationTaskItem,
  handlers: {
    onCancelSession?: (sessionId: string) => void;
    onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
    onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  },
): boolean {
  if (item.status !== "running" || !item.cancellable) return false;
  if (handlers.onStopSessionConversationTask) return true;
  if (item.cancelMode === "invocation") {
    return Boolean(item.invocationKey?.trim() && handlers.onCancelOmcDirectBatchInvocation);
  }
  return Boolean(item.sessionId?.trim() && handlers.onCancelSession);
}

/** 将仍在运行中的 tool_use 标记为手动结束，便于右栏与气泡同步更新。 */
export function markSessionToolUseStopped(
  session: ClaudeSession,
  toolUseId: string,
  reason = "已手动结束",
): ClaudeSession {
  const id = toolUseId.trim();
  if (!id) return session;
  return {
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== "tool_use" || part.id !== id) return part;
        if (part.status === "completed" || part.output?.trim()) return part;
        return {
          ...part,
          status: "error" as const,
          error: part.error?.trim() || reason,
        };
      }),
    })),
  };
}

export function findMergedToolUseInSession(
  messages: ClaudeSession["messages"],
  toolUseId: string,
): ToolUsePart | null {
  const id = toolUseId.trim();
  if (!id) return null;
  return mergeToolUseParts(messages).find((part) => part.id === id) ?? null;
}

function filterMessagePartsForTool(message: ClaudeMessage, toolUseId: string): MessagePart[] {
  const id = toolUseId.trim();
  return message.parts.filter((part) => {
    if (part.type === "tool_use") return part.id === id;
    if (part.type === "text" || part.type === "reasoning") return true;
    return false;
  });
}

/** 提取与指定 tool_use 相关的会话片段，供详情 drawer 展示。 */
export function buildConversationTaskDetailMessages(
  messages: ClaudeSession["messages"],
  toolUseId: string,
): ClaudeMessage[] {
  const id = toolUseId.trim();
  if (!id) return [];

  const out: ClaudeMessage[] = [];
  let collecting = false;
  for (const message of messages) {
    const containsTool = message.parts.some((part) => part.type === "tool_use" && part.id === id);
    if (containsTool) {
      collecting = true;
      const parts = filterMessagePartsForTool(message, id);
      if (parts.length > 0) {
        out.push({
          ...message,
          parts,
          content: parts
            .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        });
      }
      continue;
    }
    if (!collecting) continue;

    if (message.role === "user") {
      if (!isToolOnlyUserMessage(message)) break;
      const parts = message.parts.filter((part) => part.type === "tool_use" && part.id === id);
      if (parts.length > 0) {
        out.push({
          ...message,
          parts,
          content: parts
            .filter((p): p is ToolUsePart => p.type === "tool_use")
            .map((p) => p.output ?? "")
            .join("\n\n"),
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const hasOtherTool = message.parts.some((part) => part.type === "tool_use" && part.id !== id);
      if (hasOtherTool) break;
      out.push(message);
      const hasSummaryText = message.parts.some(
        (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
      );
      if (hasSummaryText) break;
    }
  }
  return out;
}

export function buildSessionConversationTaskDetailSession(
  session: ClaudeSession,
  task: SessionConversationTaskItem,
  sessions?: readonly ClaudeSession[],
): ClaudeSession {
  if (task.source === "execution_environment") {
    const workerId = task.sessionId?.trim() ?? "";
    const worker =
      findExecutionEnvironmentWorkerForTaskDetail(sessions ?? [], {
        workerSessionId: workerId,
        repositoryPath: task.repositoryPath,
      }) ?? (workerId && session.id === workerId ? session : null);
    if (worker && isExecutionEnvironmentWorkerRepositoryName(worker.repositoryName)) {
      const status: ClaudeSession["status"] =
        task.status === "running" ? "running" : task.status === "failed" ? "error" : "completed";
      const promptFallback = task.previewText?.replace(/\s+/g, " ").trim();
      const messages =
        worker.messages.length > 0
          ? worker.messages
          : promptFallback
            ? [
                {
                  id: 1,
                  role: "user" as const,
                  content: promptFallback,
                  parts: [{ type: "text" as const, text: promptFallback }],
                  timestamp: (task.updatedAt || Date.now()) - 1,
                },
              ]
            : worker.messages;
      return {
        ...worker,
        id: `${worker.id}::exec-env::${task.key}`,
        status,
        messages,
      };
    }
  }

  const toolUseId = task.toolUseId?.trim() ?? "";
  const detailMessages = toolUseId ? buildConversationTaskDetailMessages(session.messages, toolUseId) : [];
  const status: ClaudeSession["status"] =
    task.status === "running" ? "running" : task.status === "failed" ? "error" : "completed";

  if (detailMessages.length > 0) {
    return {
      ...session,
      id: `${session.id}::task::${toolUseId || task.key}`,
      status,
      messages: detailMessages,
    };
  }

  const toolPart = toolUseId ? findMergedToolUseInSession(session.messages, toolUseId) : null;
  const now = task.updatedAt || Date.now();
  const inputText =
    toolPart?.input && typeof toolPart.input === "object"
      ? JSON.stringify(toolPart.input, null, 2)
      : task.previewText;
  const outputText = toolPart?.output?.trim() || toolPart?.error?.trim() || task.previewText || "暂无输出";

  return {
    ...session,
    id: `${session.id}::task::${task.key}`,
    status,
    messages: [
      {
        id: 1,
        role: "user",
        content: inputText,
        parts: [{ type: "text", text: inputText }],
        timestamp: now - 500,
      },
      {
        id: 2,
        role: "assistant",
        content: outputText,
        parts: toolPart
          ? [{ ...toolPart, status: toolPart.status ?? (task.status === "failed" ? "error" : "completed") }]
          : [{ type: "text", text: outputText }],
        timestamp: now,
      },
    ],
  };
}
