import type { MessagePart, ToolUsePart, ToolUseDiagnostics } from "../types";
import { unwrapClaudeStreamLineRoot } from "../notifications/streamIngest";
import { humanizeClaudeError } from "../utils/humanizeClaudeError";

export type ExtractPartsFromParsedResult = {
  parts: MessagePart[];
  isInit: boolean;
  sessionId: string | null;
  isResultFullText?: boolean;
  /** content_block_start(text) 后首个 delta 应另起 text part。 */
  startNewTextBlock?: boolean;
  /** content_block_start(thinking) 后首个 delta 应另起 reasoning part。 */
  startNewReasoningBlock?: boolean;
};

/**
 * 流式行安全 JSON 解析：失败返回 null。
 * 与各 `*FromStreamLine` 旧实现里 `try { JSON.parse } catch { return 默认 }` 的兜底语义一致，
 * 供入口处解析一次后把已 parse 对象传给 `*FromParsed`，避免同一行被反复 parse。
 */
function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 非数组的普通对象才视为 record；数组/原始类型返回 null（与既有 extract 守卫一致）。 */
function asNonArrayRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const EMPTY_RECORD: Record<string, unknown> = {};

/**
 * 模拟 `a ?? b ?? ...` 链：返回首个非 null/undefined 的字段值；均缺失则 undefined。
 * 后续统一经 `typeof raw === "string"` 判定，故 null/undefined 行为等价于 `??` 链。
 */
function pickFirstDefined(json: Record<string, unknown>, fields: readonly string[]): unknown {
  for (const f of fields) {
    const v = json[f];
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

/** Built-in `Write` tool name is matched case-insensitively. */
function isWriteToolName(name: unknown): name is string {
  return typeof name === "string" && name.trim().toLowerCase() === "write";
}

/**
 * Inspect a tool_use `input` and decide whether it looks like the
 * "model produced a `Write` call but forgot `file_path`" defect.
 * Returns `suspected: true` when `input` is empty / missing object / has
 * no `file_path` key. We deliberately keep scope tight: only `Write`,
 * only the `file_path` field.
 */
export function describeWriteInputDefect(input: unknown): {
  suspected: boolean;
  rawInput?: Record<string, unknown>;
} {
  if (input === null || input === undefined) {
    return { suspected: true };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { suspected: false };
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return { suspected: true, rawInput: obj };
  }
  if (obj.file_path === undefined || obj.file_path === null || obj.file_path === "") {
    return { suspected: true, rawInput: obj };
  }
  return { suspected: false };
}

/**
 * Recognize Claude Code's `<tool_use_error>InputValidationError: Write failed ...
 * file_path is missing</tool_use_error>` shape inside a `tool_result` content
 * text. Returns the diagnostic kind (or `null` for unrelated errors) plus
 * the raw text so the caller can keep it on the part.
 */
export function isClaudeToolInputValidationErrorText(
  text: string,
): { kind: "write-missing-file_path"; raw: string } | null {
  const normalized = text.trim();
  if (!normalized) return null;
  if (!/^<tool_use_error>[\s\S]*<\/tool_use_error>$/i.test(normalized)) return null;
  if (!/InputValidationError/i.test(normalized)) return null;
  if (/Write failed/i.test(normalized) && /file_path[`\s]+is\s+missing/i.test(normalized)) {
    return { kind: "write-missing-file_path", raw: normalized };
  }
  return null;
}

/** Extract plain text from a `tool_result` content payload (string | array | undefined). */
function toolResultContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => (c as { type?: unknown }).type === "text")
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("");
}

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
    const diagnostics: ToolUseDiagnostics | undefined = (() => {
      if (!isError) return undefined;
      const contentText = toolResultContentText(b.content);
      const match = isClaudeToolInputValidationErrorText(contentText);
      if (!match) return undefined;
      return {
        writeMissingFilePath: {
          suspected: true,
          confirmed: true,
        },
      };
    })();
    parts.push({
      type: "tool_use",
      id: toolUseId,
      name: typeof b.name === "string" ? b.name : "",
      input: {},
      output: isError ? "" : rawOutput,
      status: isError ? "error" : "completed",
      error: isError ? rawOutput : undefined,
      ...(diagnostics ? { diagnostics } : {}),
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
const CODEX_SESSION_ID_FIELDS = ["sessionId", "session_id"] as const;
const OPENCODE_SESSION_ID_FIELDS = ["sessionId", "session_id"] as const;
const QODER_SESSION_ID_FIELDS = ["sessionId", "session_id"] as const;
const CURSOR_AGENT_ID_FIELDS = ["agentId", "agent_id"] as const;

export function extractCodexResumeSessionIdFromParsed(obj: unknown): string | null {
  return extractExternalAgentIdFromParsed(obj, "codex_session", CODEX_SESSION_ID_FIELDS);
}

export function shouldClearCodexResumeSessionFromParsed(obj: unknown): boolean {
  return shouldClearExternalAgentIdFromParsed(obj, "codex_session", CODEX_SESSION_ID_FIELDS);
}

export function extractOpencodeResumeSessionIdFromParsed(obj: unknown): string | null {
  return extractExternalAgentIdFromParsed(obj, "opencode_session", OPENCODE_SESSION_ID_FIELDS);
}

export function shouldClearOpencodeResumeSessionFromParsed(obj: unknown): boolean {
  return shouldClearExternalAgentIdFromParsed(obj, "opencode_session", OPENCODE_SESSION_ID_FIELDS);
}

export function extractQoderResumeSessionIdFromParsed(obj: unknown): string | null {
  return extractExternalAgentIdFromParsed(obj, "qoder_session", QODER_SESSION_ID_FIELDS);
}

export function shouldClearQoderResumeSessionFromParsed(obj: unknown): boolean {
  return shouldClearExternalAgentIdFromParsed(obj, "qoder_session", QODER_SESSION_ID_FIELDS);
}

export function extractCursorAgentIdFromParsed(obj: unknown): string | null {
  return extractExternalAgentIdFromParsed(obj, "cursor_agent", CURSOR_AGENT_ID_FIELDS);
}

/** Codex / Opencode / Cursor 绑定行同构：type 匹配 → 取首个非空 id 字段 → trim 后非空才返回。 */
function extractExternalAgentIdFromParsed(
  obj: unknown,
  expectedType: string,
  idFields: readonly string[],
): string | null {
  const json = asNonArrayRecord(obj);
  if (!json || json.type !== expectedType) return null;
  const raw = pickFirstDefined(json, idFields);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Codex / Opencode 清除标记：type 匹配且 id 字段为空字符串。 */
function shouldClearExternalAgentIdFromParsed(
  obj: unknown,
  expectedType: string,
  idFields: readonly string[],
): boolean {
  const json = asNonArrayRecord(obj);
  if (!json || json.type !== expectedType) return false;
  const raw = pickFirstDefined(json, idFields);
  return typeof raw === "string" && raw.trim().length === 0;
}

// 向后兼容的薄包装：仅做一次 JSON.parse 后转发到 *FromParsed，供 Hub/transcript/test 等现有调用方零改动使用。
export function extractCodexResumeSessionIdFromStreamLine(line: string): string | null {
  return extractCodexResumeSessionIdFromParsed(safeJsonParse(line));
}

export function shouldClearCodexResumeSessionFromStreamLine(line: string): boolean {
  return shouldClearCodexResumeSessionFromParsed(safeJsonParse(line));
}

export function extractOpencodeResumeSessionIdFromStreamLine(line: string): string | null {
  return extractOpencodeResumeSessionIdFromParsed(safeJsonParse(line));
}

export function shouldClearOpencodeResumeSessionFromStreamLine(line: string): boolean {
  return shouldClearOpencodeResumeSessionFromParsed(safeJsonParse(line));
}

export function extractQoderResumeSessionIdFromStreamLine(line: string): string | null {
  return extractQoderResumeSessionIdFromParsed(safeJsonParse(line));
}

export function shouldClearQoderResumeSessionFromStreamLine(line: string): boolean {
  return shouldClearQoderResumeSessionFromParsed(safeJsonParse(line));
}

export function extractCursorAgentIdFromStreamLine(line: string): string | null {
  return extractCursorAgentIdFromParsed(safeJsonParse(line));
}

export function extractCursorAgentIdFromCompletePayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>).cursorAgentId
    ?? (payload as Record<string, unknown>).cursor_agent_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractPartsFromParsed(obj: unknown): ExtractPartsFromParsedResult {
  try {
    const json = unwrapClaudeStreamLineRoot(
      asNonArrayRecord(obj) ?? EMPTY_RECORD,
    ) as Record<string, unknown> & {
      type?: string;
      subtype?: string;
      session_id?: string;
      sessionId?: string;
      message?: { content?: unknown };
      result?: string;
      output?: string;
      delta?: { text?: string };
      content_block?: { type?: string; text?: string; thinking?: string };
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

    // SDK stream-json：新 content block 开始 —— 下一 delta 应另起 part，对齐 JSONL 多 block 结构。
    if (json.type === "content_block_start") {
      const blockType = typeof json.content_block?.type === "string" ? json.content_block.type : "";
      if (blockType === "text") {
        return { parts: [], isInit: false, sessionId: null, startNewTextBlock: true };
      }
      if (blockType === "thinking") {
        return { parts: [], isInit: false, sessionId: null, startNewReasoningBlock: true };
      }
      return { parts: [], isInit: false, sessionId: null };
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
        // result 事件的 json.result 是整轮最终文本（delta 已增量累积过），标记为权威全文：
        // 上游 runtime 据此跳过与 delta 累积末尾 text part 的拼接，避免正文翻倍（同段重复）。
        return { parts: [{ type: "text", text: resultText }], isInit: false, sessionId: null, isResultFullText: true };
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
            const name = typeof b.name === "string" ? b.name : "unknown";
            const input = (typeof b.input === "object" && b.input !== null && !Array.isArray(b.input))
              ? (b.input as Record<string, unknown>)
              : {};
            let diagnostics: ToolUseDiagnostics | undefined;
            if (isWriteToolName(name)) {
              const defect = describeWriteInputDefect(input);
              if (defect.suspected) {
                diagnostics = {
                  writeMissingFilePath: {
                    suspected: true,
                    confirmed: false,
                    ...(defect.rawInput ? { rawInput: defect.rawInput } : {}),
                  },
                };
              }
            }
            parts.push({
              type: "tool_use",
              id: b.id || `tool_${Date.now()}`,
              name,
              input,
              status: "running",
              ...(diagnostics ? { diagnostics } : {}),
            } satisfies ToolUsePart);
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

/** 向后兼容薄包装：解析一次后转发到 {@link extractPartsFromParsed}。 */
export function extractPartsFromStreamLine(line: string): { parts: MessagePart[]; isInit: boolean; sessionId: string | null; isResultFullText?: boolean } {
  return extractPartsFromParsed(safeJsonParse(line));
}

/** Claude Code `type:result` + `is_error:true` 轮次失败摘要（含工具调用无法解析）。 */
export function extractResultErrorMessageFromParsed(obj: unknown): string | null {
  const p = asNonArrayRecord(obj) ?? EMPTY_RECORD;
  if (p.type !== "result" || p.is_error !== true) return null;
  const r = typeof p.result === "string" ? p.result.trim() : "";
  if (r) return r;
  const errs = p.errors;
  if (typeof errs === "string" && errs.trim()) return errs.trim();
  return "Claude Code 返回错误结果";
}

/** 向后兼容薄包装：解析一次后转发到 {@link extractResultErrorMessageFromParsed}。 */
export function extractResultErrorMessageFromStreamLine(line: string): string | null {
  return extractResultErrorMessageFromParsed(safeJsonParse(line));
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
  const validation = isClaudeToolInputValidationErrorText(trimmed);
  if (validation?.kind === "write-missing-file_path") {
    return "Claude 工具调用未通过 schema 校验：Write 工具缺少 file_path 字段（模型产物截断或上游 schema 被改写）。建议：直接重新发送该消息；如反复出现，检查 ~/.claude/settings.json 中是否注入了改写 Write 工具的 MCP server / 插件 / --append-system-prompt。";
  }
  return `Claude 轮次失败: ${humanizeClaudeError(trimmed)}`;
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
  const afterMalformed = text.replace(
    /Your tool call was malformed and could not be parsed\.?\s*(Please retry\.?)?/gi,
    "",
  );
  const afterParsed = afterMalformed.replace(
    /The model's tool call could not be parsed[^.\n]*(?:\([^)]*\))?\.?/gi,
    "",
  );
  // 仅当确实剔除了 CLI 注入文案时才压缩多空白（含段落分隔 \n\n）。否则原样返回，
  // 保留正常助手回复的 \n\n 段落分隔——无条件压缩会把实时流式文本段落压成单空格，
  // 导致「实时接收段落粘连、刷新磁盘态（不经过此函数）段落清晰」的渲染分歧。
  if (afterParsed === text) return text;
  return afterParsed.replace(/\s{2,}/g, " ").trim();
}

/** Claude stream-json 中占位/无信息量的 system error 文案，不应写入会话 UI。 */
function isIgnorableClaudeStreamSystemErrorDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  return normalized === "unknown" || normalized === "undefined";
}

export function isHookStartedFromParsed(obj: unknown): boolean {
  const json = asNonArrayRecord(obj) ?? EMPTY_RECORD;
  const type = typeof json.type === "string" ? json.type : "";
  const subtype = typeof json.subtype === "string" ? json.subtype : "";
  return type === "system" && subtype === "hook_started";
}

/** 向后兼容薄包装：解析一次后转发到 {@link isHookStartedFromParsed}。 */
export function isHookStartedStreamLine(line: string): boolean {
  return isHookStartedFromParsed(safeJsonParse(line));
}

export function extractSystemErrorMessageFromParsed(obj: unknown): string | null {
  const json = asNonArrayRecord(obj) ?? EMPTY_RECORD;
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
    return `Claude 系统错误: ${humanizeClaudeError(msg)}`;
  }
  return null;
}

/** 向后兼容薄包装：解析一次后转发到 {@link extractSystemErrorMessageFromParsed}。 */
export function extractSystemErrorMessageFromStreamLine(line: string): string | null {
  return extractSystemErrorMessageFromParsed(safeJsonParse(line));
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
    // 入口解析一次，复用给 parts 与 session_id 提取（原先每行各 parse 一次共 2 次）。
    const parsed = safeJsonParse(line);
    const r = extractPartsFromParsed(parsed);
    if (r.isInit && r.sessionId?.trim()) return r.sessionId.trim();
    const anySid = parseStreamLineSessionIdFromParsed(parsed);
    if (anySid) return anySid;
  }
  return null;
}

/** stream-json 行首级 `session_id`（若存在），用于在 ref 漂移时仍将输出归到正确标签。 */
export function parseStreamLineSessionIdFromParsed(obj: unknown): string | null {
  try {
    const j0 = asNonArrayRecord(obj) ?? EMPTY_RECORD;
    const j = unwrapClaudeStreamLineRoot(j0);
    const sid = typeof j.session_id === "string" ? j.session_id : j.sessionId;
    return typeof sid === "string" && sid.trim().length > 0 ? sid.trim() : null;
  } catch {
    return null;
  }
}

/** 向后兼容薄包装：解析一次后转发到 {@link parseStreamLineSessionIdFromParsed}。 */
export function parseStreamLineSessionId(line: string): string | null {
  return parseStreamLineSessionIdFromParsed(safeJsonParse(line));
}

