import type { BackgroundInvocationSnapshot } from "../services/backgroundInvocationSnapshot";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import type { ClaudeMessage, ClaudeSession, MessagePart, SessionConversationTaskItem, ToolUsePart } from "../types";
import { indexOfLastRenderableUserMessage, isToolOnlyUserMessage } from "./claudeChatMessageDisplay";
import { isOmcDirectBatchInvocationRunning } from "./omcDirectBatchInvocationDisplay";

function truncate(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
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
): SessionConversationTaskItem["status"] | null {
  if (part.status === "error" || part.error?.trim()) return "failed";
  if (part.status === "completed" || part.output?.trim()) return "completed";
  if (part.status === "pending" || part.status === "running") {
    if (hasSettledAfterToolUse(messages, part.id)) return "completed";
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

export function buildSessionConversationTasks(input: {
  session: ClaudeSession | null | undefined;
  directBatchInvocations?: readonly WorkflowInvocationStreamDetail[];
  repositoryInvocations?: readonly WorkflowInvocationStreamDetail[];
  bundleSnapshots?: readonly BackgroundInvocationSnapshot[];
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
    const status = resolveConversationTaskToolStatus(part, session.messages);
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
  },
): boolean {
  if (item.status !== "running" || !item.cancellable) return false;
  if (item.cancelMode === "invocation") {
    return Boolean(item.invocationKey?.trim() && handlers.onCancelOmcDirectBatchInvocation);
  }
  return Boolean(item.sessionId?.trim() && handlers.onCancelSession);
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
): ClaudeSession {
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
