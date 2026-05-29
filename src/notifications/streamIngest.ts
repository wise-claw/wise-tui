/**
 * 从 Claude Code `stream-json` 单行解析 Hub 信号（Phase 3+）。
 * 协议参考 community 文档：`sdk_control_request` / `control_request`（permission / user_question 等）。
 * 部分模型或网关只把 AskUserQuestion 以 `assistant.message.content` 里的 `tool_use` 流出，无单独 control 行，故增加兜底解析。
 *
 * `sessionId` 必须与流式路由一致（见 `claudeStreamRuntime` 里 `ingestClaudeStreamLineForHub(tid, …)` 的 tab id）：
 * 主会话、员工独立标签、团队流程会话各自写入 `notificationHub` 独立桶；并行多路时互不覆盖。
 * 同一桶内连续多道 AskUserQuestion 由 Hub 入 FIFO 队列（见 `setQuestionRequest`）。
 */

import type { MessagePart, PermissionRequest, QuestionRequest } from "../types";
import { notificationHub } from "./hub";
import { extractTodoWriteFromMessageParts, isTodoWriteToolName, parseTodoWriteInput } from "./todoIngest";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

/** 将 request_id 压成稳定片段，仅用于合成无原生 value 的选项 id（与 opt_0 区分，避免多题 DOM/状态串线）。 */
function optionValueScope(requestId: string): string {
  const t = requestId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return (t.length > 0 ? t : "q").slice(0, 96);
}

/** Claude Code AskUserQuestion：扁平字段或 `questions[]`（见 tool_inputs AskUserQuestionInput）。 */
function normalizeAskUserOptions(rawOpts: unknown, requestId: string): { value: string; label: string }[] {
  const scope = optionValueScope(requestId);
  const options: { value: string; label: string }[] = [];
  if (!Array.isArray(rawOpts)) return options;
  if (rawOpts.length > 0 && rawOpts.every((x) => typeof x === "string")) {
    return rawOpts.map((label, i) => ({
      value: `opt_${i}`,
      label: String(label).trim() || `选项${i + 1}`,
    }));
  }
  for (const o of rawOpts) {
    const or = asRecord(o);
    if (!or) continue;
    const labelBase = str(or.label) ?? str(or.title) ?? str(or.text) ?? "";
    const desc = str(or.description)?.trim();
    const label =
      labelBase && desc && desc !== labelBase ? `${labelBase}（${desc}）` : (labelBase || desc || "");
    const value = (str(or.value) ?? str(or.id) ?? labelBase) || desc || "";
    if (!value && !label) continue;
    const native = (value || label || "").trim();
    const fallback = `wiseq:${scope}:o:${options.length}`;
    options.push({
      value: native || fallback,
      label: label || value || fallback,
    });
  }
  return options;
}

function isAskUserQuestionName(name: unknown): boolean {
  const n = typeof name === "string" ? name : "";
  return n === "AskUserQuestion" || n.includes("AskUserQuestion") || n.includes("AskUser");
}

/**
 * 从 control 的 request 与 tool_input，或纯 tool input，组装 QuestionRequest。
 * @param defaultOkOption sdk_control 且无任何选项时的占位；tool_use 兜底不传则选项为空时不建 Dock
 */
function buildQuestionRequestFromAskUserFields(
  requestId: string,
  req: Record<string, unknown>,
  toolInput: Record<string, unknown>,
  defaultOkOption: boolean,
): QuestionRequest | null {
  let question =
    str(req.question) ?? str(toolInput.question) ?? str(toolInput.prompt) ?? str(toolInput.header) ?? "";
  let rawOpts: unknown = req.options ?? toolInput.options ?? toolInput.choices ?? toolInput.answers;
  let multiSelect = Boolean(
    req.multi_select ?? req.multiSelect ?? toolInput.multi_select ?? toolInput.multiSelect,
  );

  const qs = toolInput.questions;
  if (Array.isArray(qs) && qs.length > 0) {
    const q0 = asRecord(qs[0]);
    if (q0) {
      const qText = str(req.question) ?? str(q0.question) ?? str(q0.header);
      if (qText) question = qText;
      rawOpts = q0.options ?? rawOpts;
      multiSelect = Boolean(
        req.multi_select ?? req.multiSelect ?? q0.multiSelect ?? q0.multi_select ?? multiSelect,
      );
    }
  }

  const hasRealQuestion = question.trim().length > 0;
  if (!hasRealQuestion) question = "请选择一项";

  let parsedOpts = rawOpts;
  if (typeof parsedOpts === "string" && parsedOpts.trim().startsWith("[")) {
    try {
      parsedOpts = JSON.parse(parsedOpts) as unknown;
    } catch {
      /* keep string */
    }
  }

  let options = normalizeAskUserOptions(parsedOpts, requestId);
  if (options.length === 0 && defaultOkOption) {
    // 与同一 AskUserQuestion 的 `assistant.tool_use` / `sdk_control_request` 双通道协同：
    // 若 control 通道仅作占位（既无题干又无选项），别造「请选择一项 + 确定」假题，
    // 避免在真正的题卡之外再多塞一个无意义的「确认弹窗」。
    if (!hasRealQuestion) return null;
    options = [{ value: "ok", label: "确定" }];
  }
  if (options.length === 0) return null;

  return {
    id: requestId,
    question,
    options,
    multiSelect,
  };
}

/** 供 stream ingest 与 `claudeStreamParser` 共用，解析被 `stream_event` 包裹的 stream-json 根对象。 */
export function unwrapClaudeStreamLineRoot(j: Record<string, unknown>): Record<string, unknown> {
  const typ = str(j.type) ?? "";
  if (typ === "stream_event" || typ === "event") {
    const inner = asRecord(j.event) ?? asRecord(j.payload) ?? asRecord(j.data);
    if (inner) return unwrapClaudeStreamLineRoot(inner);
  }
  return j;
}

function ingestAskUserQuestionFromAssistantToolUse(sessionId: string, j: Record<string, unknown>): void {
  const root = unwrapClaudeStreamLineRoot(j);
  const t = str(root.type)?.toLowerCase() ?? "";
  if (t !== "assistant" && t !== "message") return;

  let content: unknown;
  if (t === "assistant") {
    const msg = asRecord(root.message);
    if (!msg) return;
    content = msg.content;
  } else {
    const role = str(root.role)?.toLowerCase();
    if (role === "user") return;
    if (role && role !== "assistant" && role !== "model") return;
    content = asRecord(root.message)?.content ?? root.content;
  }
  if (!Array.isArray(content)) return;

  for (const block of content) {
    const b = asRecord(block);
    if (!b || b.type !== "tool_use") continue;
    if (isTodoWriteToolName(str(b.name))) {
      let todoInput: unknown = b.input;
      if (typeof todoInput === "string") {
        try {
          todoInput = JSON.parse(todoInput) as unknown;
        } catch {
          todoInput = null;
        }
      }
      const parsed = parseTodoWriteInput(todoInput);
      if (parsed) {
        notificationHub.applyTodoWrite(sessionId, parsed.items, parsed.merge);
      }
      continue;
    }

    if (!isAskUserQuestionName(b.name)) continue;

    const requestId = str(b.id)?.trim();
    if (!requestId) continue;

    let input = asRecord(b.input) ?? {};
    if (input.input !== undefined && typeof input.input === "string") {
      try {
        const nested = JSON.parse(input.input) as unknown;
        const rec = asRecord(nested);
        if (rec) input = { ...input, ...rec };
      } catch {
        /* ignore */
      }
    }
    if (Object.keys(input).length === 0 && typeof b.input === "string") {
      try {
        const parsed = JSON.parse(b.input) as unknown;
        const rec = asRecord(parsed);
        if (rec) input = rec;
      } catch {
        /* ignore */
      }
    }
    let payload = buildQuestionRequestFromAskUserFields(requestId, {}, input, false);
    if (!payload) {
      payload = buildQuestionRequestFromAskUserFields(requestId, {}, input, true);
    }
    if (!payload) continue;

    // 仅靠 id 去重在「同一 AskUserQuestion 通过 tool_use + sdk_control_request 双通道并发到达」时无效，
    // 让 Hub.setQuestionRequest 按 id+内容签名一并去重；这里继续按 id 命中再写入即可。
    notificationHub.setQuestionRequest(sessionId, payload);
    return;
  }
}

/**
 * 兜底：从已解析的 message parts 中提取 AskUserQuestion（当控制行缺字段或缺失时）。
 * 典型场景：UI 已出现 `tool_use AskUserQuestion`，但 `sdk_control_request` 未携带可用 `tool_input`。
 */
export function ingestTodoWriteFromMessageParts(sessionId: string, parts: readonly MessagePart[]): void {
  if (!sessionId || parts.length === 0) return;
  const batch = extractTodoWriteFromMessageParts(parts);
  if (!batch) return;
  notificationHub.applyTodoWrite(sessionId, batch.items, batch.merge);
}

export function ingestAskUserQuestionFromMessageParts(sessionId: string, parts: readonly MessagePart[]): void {
  if (!sessionId || parts.length === 0) return;
  ingestTodoWriteFromMessageParts(sessionId, parts);
  for (const part of parts) {
    if (part.type !== "tool_use") continue;
    if (!isAskUserQuestionName(part.name)) continue;
    const requestId = typeof part.id === "string" ? part.id.trim() : "";
    if (!requestId) continue;
    const input = asRecord(part.input) ?? {};
    let payload = buildQuestionRequestFromAskUserFields(requestId, {}, input, false);
    if (!payload) {
      payload = buildQuestionRequestFromAskUserFields(requestId, {}, input, true);
    }
    if (!payload) continue;
    notificationHub.setQuestionRequest(sessionId, payload);
    return;
  }
}

/** 将 stdout 一行 JSON 并入 Hub（权限等）；解析失败则忽略。 */
export function ingestClaudeStreamLineForHub(sessionId: string, line: string): void {
  if (!sessionId || !line.trim()) return;
  let root: unknown;
  try {
    root = JSON.parse(line) as unknown;
  } catch {
    return;
  }
  let j = asRecord(root);
  if (!j) return;
  j = unwrapClaudeStreamLineRoot(j);

  const typ = str(j.type);
  const isControlLine = typ === "sdk_control_request" || typ === "control_request";

  if (isControlLine) {
    const req = asRecord(j.request);
    if (!req) return;
    const sub = str(req.subtype) ?? "";
    const toolName = str(req.tool_name) ?? str(req.toolName) ?? "";

    // MCP / 插件工具名常为 `mcp__*`、`plugin:*`，一般仍带 `subtype: "permission"`；兼容带 `permission` 子串的 subtype 变体。
    const subLower = sub.toLowerCase();
    const toolLower = toolName.toLowerCase();
    const isPermissionControl =
      sub === "permission" ||
      subLower.includes("permission") ||
      toolLower.includes("permission");
    if (isPermissionControl) {
      const requestId = str(req.request_id) ?? str(req.requestId);
      if (!requestId) return;

      const tool = toolName || "unknown";
      const toolInput = req.tool_input ?? req.toolInput;
      const description =
        typeof toolInput === "object" && toolInput !== null
          ? JSON.stringify(toolInput, null, 0).slice(0, 2000)
          : str(toolInput) ?? "需要确认的工具调用";

      const payload: PermissionRequest = {
        id: requestId,
        tool,
        description,
        filePatterns: undefined,
      };

      notificationHub.setPermissionRequest(sessionId, payload);
      return;
    }

    if (
      sub === "user_question" ||
      sub === "ask_user" ||
      toolName === "AskUserQuestion" ||
      toolName.includes("AskUser")
    ) {
      const requestId = str(req.request_id) ?? str(req.requestId) ?? `question_${Date.now()}`;
      const toolInput = asRecord(req.tool_input ?? req.toolInput) ?? {};
      const payload = buildQuestionRequestFromAskUserFields(requestId, req, toolInput, true);
      if (payload) {
        notificationHub.setQuestionRequest(sessionId, payload);
      }
    }
    return;
  }

  ingestAskUserQuestionFromAssistantToolUse(sessionId, j);
}

/** 构造写入 Claude stdin 的 `control_response` 一行 JSON（permission 决策）。 */
export function buildPermissionStdinLine(
  requestId: string,
  decision: "allow_once" | "allow_always" | "deny",
): string {
  if (decision === "deny") {
    return JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { behavior: "deny", message: "用户已拒绝" },
      },
    });
  }
  // allow_once / allow_always：CLI 侧暂不区分「始终」持久化，先统一为 allow
  return JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "allow" },
    },
  });
}

/**
 * 构造写入 stdin 的「选择题已答」文案：优先展示选项 label，避免只传 opt_0 导致模型读不懂；
 * 若有补充说明与多选，一并写入 message（CLI 常把 message 写进 tool_result）。
 */
function buildQuestionResponseMessage(
  detail: Pick<QuestionRequest, "options"> | null | undefined,
  answers: string[],
  customAnswer?: string,
): string {
  const byValue =
    detail?.options?.length ?
      new Map(detail.options.map((o) => [o.value, o.label.trim() || o.value]))
    : null;
  const chosen = answers.filter(Boolean).map((v) => byValue?.get(v) ?? v).filter(Boolean);
  const selection = chosen.length > 0 ? chosen.join("、") : "";
  const extra = customAnswer?.trim();
  const bits: string[] = [];
  if (selection) bits.push(`已选：${selection}`);
  if (extra) bits.push(`补充：${extra}`);
  if (bits.length === 0) return "（跳过）";
  return bits.join("；").slice(0, 8000);
}

/** 追问 / 选择题：以 allow + message 形式回传；并附带 answers / answer_labels 供运行时写入结构化 tool 结果。 */
export function buildQuestionStdinLine(
  requestId: string,
  answers: string[],
  customAnswer?: string,
  requestDetail?: Pick<QuestionRequest, "options"> | null,
): string {
  const text = buildQuestionResponseMessage(requestDetail ?? null, answers, customAnswer);
  const valueAnswers = answers.filter(Boolean);
  const inner: Record<string, unknown> = {
    behavior: "allow",
    message: text,
    answers: valueAnswers,
  };
  if (requestDetail?.options?.length && valueAnswers.length > 0) {
    const byValue = new Map(requestDetail.options.map((o) => [o.value, o.label.trim() || o.value]));
    const labels = valueAnswers.map((v) => byValue.get(v) ?? v).filter(Boolean);
    if (labels.length) inner.answer_labels = labels;
  }
  return JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: inner,
    },
  });
}
