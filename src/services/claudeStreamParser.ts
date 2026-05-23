import type { MessagePart } from "../types";
import { unwrapClaudeStreamLineRoot } from "../notifications/streamIngest";

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
        return { parts: [{ type: "text", text: blocks }], isInit: false, sessionId: null };
      }
      if (Array.isArray(blocks)) {
        const parts: MessagePart[] = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) {
            parts.push({ type: "text", text: b.text });
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
          }
        }
        if (parts.length > 0) return { parts, isInit: false, sessionId: null };
      }
    }

    // Tool result
    if (json.type === "assistant" && json.message?.content) {
      const blocks = json.message.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b.type === "tool_result") {
            const content = Array.isArray(b.content)
              ? b.content
                  .filter((c: unknown) => {
                    if (!c || typeof c !== "object") return false;
                    return (c as { type?: unknown }).type === "text";
                  })
                  .map((c: unknown) => ((c as { text?: unknown }).text as string) ?? "")
                  .join("")
              : b.content || "";
            return {
              parts: [{
                type: "tool_use",
                id: b.tool_use_id || "",
                name: "",
                input: {},
                output: typeof content === "string" ? content : JSON.stringify(content),
                status: b.is_error ? "error" : "completed",
                error: b.is_error ? (typeof content === "string" ? content : undefined) : undefined,
              }],
              isInit: false,
              sessionId: null,
            };
          }
        }
      }
    }

    // User message echo
    if (json.type === "user" && json.message?.content) {
      const blocks = json.message.content;
      if (Array.isArray(blocks)) {
        const textParts = blocks
          .filter((b: unknown) => {
            if (!b || typeof b !== "object") return false;
            return (b as { type?: unknown }).type === "text";
          })
          .map((b: unknown) => ((b as { text?: unknown }).text as string) ?? "")
          .join("");
        if (textParts) return { parts: [{ type: "text", text: textParts }], isInit: false, sessionId: null };
      }
    }

    return { parts: [], isInit: false, sessionId: null };
  } catch {
    return { parts: [], isInit: false, sessionId: null };
  }
}

/** Claude stream-json 中占位/无信息量的 system error 文案，不应写入会话 UI。 */
function isIgnorableClaudeStreamSystemErrorDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  return normalized === "unknown" || normalized === "undefined";
}

export function extractSystemErrorMessageFromStreamLine(line: string): string | null {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    const type = typeof json.type === "string" ? json.type : "";
    const subtype = typeof json.subtype === "string" ? json.subtype : "";
    if (type !== "system") return null;

    if (subtype === "hook_started") {
      const hookName = typeof json.hook_name === "string" ? json.hook_name.trim() : "";
      if (hookName) {
        return `Claude Hook 启动中: ${hookName}（完成后会继续生成回复）`;
      }
      return "Claude Hook 启动中（完成后会继续生成回复）";
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

