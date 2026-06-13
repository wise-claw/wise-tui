import type { MessagePart, ToolUsePart } from "../types";
import { unwrapClaudeStreamLineRoot } from "../notifications/streamIngest";

function toolResultPartsFromContentBlocks(blocks: unknown): MessagePart[] {
  if (!Array.isArray(blocks)) return [];
  const parts: MessagePart[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (b.type !== "tool_result") continue;
    const toolUseId =
      (typeof b.tool_use_id === "string" && b.tool_use_id.trim()) ||
      (typeof b.toolUseId === "string" && b.toolUseId.trim()) ||
      "";
    if (!toolUseId) continue;
    const content = Array.isArray(b.content)
      ? b.content
          .filter((c: unknown) => {
            if (!c || typeof c !== "object") return false;
            return (c as { type?: unknown }).type === "text";
          })
          .map((c: unknown) => ((c as { text?: unknown }).text as string) ?? "")
          .join("")
      : b.content;
    const rawOutput =
      typeof content === "string" ? content : content != null ? JSON.stringify(content) : "";
    const isError = b.is_error === true;
    parts.push({
      type: "tool_use",
      id: toolUseId,
      name: typeof b.name === "string" ? b.name : "",
      input: {},
      output: isError ? "" : rawOutput,
      status: isError ? "error" : "completed",
      error: isError ? rawOutput : undefined,
    } satisfies ToolUsePart);
  }
  return parts;
}

function extractPartsFromStreamDelta(delta: unknown): MessagePart[] {
  if (!delta || typeof delta !== "object") return [];
  const d = delta as Record<string, unknown>;
  const typ = typeof d.type === "string" ? d.type : "";
  if (typ === "text_delta" && typeof d.text === "string" && d.text) {
    return [{ type: "text", text: d.text }];
  }
  if (typ === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
    return [{ type: "reasoning", text: d.thinking }];
  }
  if (typeof d.text === "string" && d.text.trim()) {
    return [{ type: "text", text: d.text }];
  }
  return [];
}

/**
 * Extract structured parts from a Claude stream-json line。
 * 与 Hub 一致地对 `stream_event` 等外壳解包，避免仅 Hub 能解析 AskUserQuestion 而 UI 气泡已展示、Dock 未写入。
 */
export function extractCodexResumeSessionIdFromStreamLine(line: string): string | null {
  try {
    const parsed: unknown = JSON.parse(line);
    const json =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (!json || json.type !== "codex_session") return null;
    const raw = json.sessionId ?? json.session_id;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function shouldClearCodexResumeSessionFromStreamLine(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    const json =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (!json || json.type !== "codex_session") return false;
    const raw = json.sessionId ?? json.session_id;
    return typeof raw === "string" && raw.trim().length === 0;
  } catch {
    return false;
  }
}

export function extractCursorAgentIdFromStreamLine(line: string): string | null {
  try {
    const parsed: unknown = JSON.parse(line);
    const json =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (!json || json.type !== "cursor_agent") return null;
    const raw = json.agentId ?? json.agent_id;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function extractCursorAgentIdFromCompletePayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>).cursorAgentId
    ?? (payload as Record<string, unknown>).cursor_agent_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractPartsFromStreamLine(line: string): { parts: MessagePart[]; isInit: boolean; sessionId: string | null } {
  try {
    const parsed: unknown = JSON.parse(line);
    const json = unwrapClaudeStreamLineRoot(
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {},
    ) as Record<string, unknown> & {
      type?: string;
      subtype?: string;
      session_id?: string;
      sessionId?: string;
      message?: { content?: unknown };
      result?: string;
      output?: string;
      delta?: { text?: string };
      content_block?: { text?: string };
      text?: string;
    };

    if (json.type === "system" && json.subtype === "init") {
      const sidRaw = json.session_id ?? json.sessionId;
      return {
        parts: [],
        isInit: true,
        sessionId: typeof sidRaw === "string" && sidRaw.trim().length > 0 ? sidRaw.trim() : null,
      };
    }

    // Some Claude Code versions emit final text on a `result` event.
    if (json.type === "result") {
      if (json.is_error === true) {
        // 模型/CLI 侧工具调用解析失败；勿写入助手气泡（见 extractResultErrorMessageFromStreamLine）。
        return { parts: [], isInit: false, sessionId: null };
      }
      const resultText =
        typeof json.result === "string"
          ? json.result
          : typeof json.output === "string"
            ? json.output
            : "";
      if (resultText.trim()) {
        return { parts: [{ type: "text", text: resultText }], isInit: false, sessionId: null };
      }
    }

    // Stream delta variants (SDK / stream-json): content_block_delta, message_delta, etc.
    if (json.type === "content_block_delta" || json.type === "message_delta") {
      const deltaParts = extractPartsFromStreamDelta(json.delta);
      if (deltaParts.length > 0) {
        return { parts: deltaParts, isInit: false, sessionId: null };
      }
    }

    const deltaParts = extractPartsFromStreamDelta(json.delta);
    if (deltaParts.length > 0) {
      return { parts: deltaParts, isInit: false, sessionId: null };
    }

    const deltaText =
      typeof json.content_block?.text === "string"
        ? json.content_block.text
        : typeof json.text === "string"
          ? json.text
          : "";
    if (deltaText.trim()) {
      return { parts: [{ type: "text", text: deltaText }], isInit: false, sessionId: null };
    }

    if (json.type === "assistant" && json.message?.content) {
      const blocks = json.message.content;
      if (typeof blocks === "string" && blocks.trim()) {
        const cleaned = stripClaudeHarnessInjectedStreamText(blocks);
        if (cleaned && !isClaudeHarnessInjectedStreamText(cleaned)) {
          return { parts: [{ type: "text", text: cleaned }], isInit: false, sessionId: null };
        }
        return { parts: [], isInit: false, sessionId: null };
      }
      if (Array.isArray(blocks)) {
        const parts: MessagePart[] = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) {
            const cleaned = stripClaudeHarnessInjectedStreamText(String(b.text));
            if (cleaned && !isClaudeHarnessInjectedStreamText(cleaned)) {
              parts.push({ type: "text", text: cleaned });
            }
          } else if (b.type === "tool_use") {
            parts.push({
              type: "tool_use",
              id: b.id || `tool_${Date.now()}`,
              name: b.name || "unknown",
              input: b.input || {},
              status: "running",
            });
          } else if (b.type === "thinking" && b.thinking) {
            parts.push({ type: "reasoning", text: b.thinking });
          } else {
            parts.push(...toolResultPartsFromContentBlocks([b]));
          }
        }
        if (parts.length > 0) return { parts, isInit: false, sessionId: null };
      }
    }

    // User 行仅合并 tool_result；CLI 注入的 retry 用户文案勿写入助手气泡。
    if (json.type === "user" && json.message?.content) {
      const blocks = json.message.content;
      if (Array.isArray(blocks)) {
        const toolResults = toolResultPartsFromContentBlocks(blocks);
        if (toolResults.length > 0) {
          return { parts: toolResults, isInit: false, sessionId: null };
        }
      }
    }

    return { parts: [], isInit: false, sessionId: null };
  } catch {
    return { parts: [], isInit: false, sessionId: null };
  }
}

/** Claude Code `type:result` + `is_error:true` 轮次失败摘要（含工具调用无法解析）。 */
export function extractResultErrorMessageFromStreamLine(line: string): string | null {
  try {
    const p = JSON.parse(line) as Record<string, unknown>;
    if (p.type !== "result" || p.is_error !== true) return null;
    const r = typeof p.result === "string" ? p.result.trim() : "";
    if (r) return r;
    const errs = p.errors;
    if (typeof errs === "string" && errs.trim()) return errs.trim();
    return "Claude Code 返回错误结果";
  } catch {
    return null;
  }
}

/** 已知 CLI 工具调用解析失败文案；勿当作「有可见助手回复」抵消 complete.success=false。 */
export function isClaudeToolCallParseFailureText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return (
    /tool call could not be parsed/i.test(normalized) ||
    /tool call was malformed/i.test(normalized)
  );
}

/** 将 CLI result 错误转为会话系统消息（已知工具解析失败用中文说明）。 */
export function formatClaudeResultErrorForSessionUi(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Claude 轮次失败：未知错误";
  if (isClaudeToolCallParseFailureText(trimmed)) {
    return "Claude 轮次失败：模型工具调用无法解析（CLI 已自动重试仍失败）。OpenCode 代理已尝试从正文提取工具调用；请重启代理并新开标签，或换 Kimi/GLM。";
  }
  return `Claude 轮次失败: ${trimmed}`;
}

/** Claude Code 注入的重试/纠错文案（常出现在 user 行或混进 assistant text）。 */
export function isClaudeHarnessInjectedStreamText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (isClaudeToolCallParseFailureText(normalized)) return true;
  return /^Your tool call was malformed and could not be parsed/i.test(normalized);
}

/** 从流式 text 块中剥离 CLI 注入文案，避免与模型正文拼成乱句。 */
export function stripClaudeHarnessInjectedStreamText(text: string): string {
  return text
    .replace(/Your tool call was malformed and could not be parsed\.?\s*(Please retry\.?)?/gi, "")
    .replace(/The model's tool call could not be parsed[^.\n]*(?:\([^)]*\))?\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Claude stream-json 中占位/无信息量的 system error 文案，不应写入会话 UI。 */
function isIgnorableClaudeStreamSystemErrorDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  return normalized === "unknown" || normalized === "undefined";
}

export function isHookStartedStreamLine(line: string): boolean {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    const type = typeof json.type === "string" ? json.type : "";
    const subtype = typeof json.subtype === "string" ? json.subtype : "";
    return type === "system" && subtype === "hook_started";
  } catch {
    return false;
  }
}

export function extractSystemErrorMessageFromStreamLine(line: string): string | null {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    const type = typeof json.type === "string" ? json.type : "";
    const subtype = typeof json.subtype === "string" ? json.subtype : "";
    if (type !== "system") return null;

    if (subtype === "hook_started") {
      return null;
    }

    if (subtype === "hook_response") {
      const outcome = typeof json.outcome === "string" ? json.outcome : "";
      if (outcome !== "error") return null;
      const output = typeof json.output === "string" ? json.output.trim() : "";
      const stderr = typeof json.stderr === "string" ? json.stderr.trim() : "";
      const message = output || stderr || "Claude Hook 执行失败";
      return `Claude Hook 错误: ${message}`;
    }

    const msg =
      typeof json.message === "string"
        ? json.message.trim()
        : typeof json.error === "string"
          ? json.error.trim()
          : "";
    if (msg && !isIgnorableClaudeStreamSystemErrorDetail(msg)) {
      return `Claude 系统错误: ${msg}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从 invocation 持久化 stdout 中解析首条 stream-json `system`/`init` 携带的 `session_id`。
 * 直连批量等 oneshot 子进程不会把该 id 写入 `ClaudeSession.claudeSessionId`，需从此处读取。
 */
export function extractInitSessionIdFromInvocationStdoutLines(lines: readonly string[]): string | null {
  const max = Math.min(lines.length, 500);
  for (let i = 0; i < max; i++) {
    const raw = lines[i];
    if (typeof raw !== "string") continue;
    const line = raw.trim();
    if (!line) continue;
    try {
      const r = extractPartsFromStreamLine(line);
      if (r.isInit && r.sessionId?.trim()) return r.sessionId.trim();
      const anySid = parseStreamLineSessionId(line);
      if (anySid) return anySid;
    } catch {
      /* 非 JSON 行 */
    }
  }
  return null;
}

/** stream-json 行首级 `session_id`（若存在），用于在 ref 漂移时仍将输出归到正确标签。 */
export function parseStreamLineSessionId(line: string): string | null {
  try {
    const p: unknown = JSON.parse(line);
    const j0 = p !== null && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    const j = unwrapClaudeStreamLineRoot(j0);
    const sid = typeof j.session_id === "string" ? j.session_id : j.sessionId;
    return typeof sid === "string" && sid.trim().length > 0 ? sid.trim() : null;
  } catch {
    return null;
  }
}

