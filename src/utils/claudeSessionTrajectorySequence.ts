import type { ClaudeMessage, MessagePart, TextPart, ToolUsePart } from "../types";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { FccTraceEntry } from "../types/fccTrace";
import {
  enrichSequenceEventsWithObservedHttp,
  INFERRED_HTTP_DETAIL_PLACEHOLDER,
} from "./sequenceEventHttpEnrichment";
import { unwrapClaudeStreamLineRoot } from "../notifications/streamIngest";
import { isToolOnlyUserMessage, userMessagePlainTextForDisplay } from "./claudeChatMessageDisplay";

export const TRAJECTORY_LANE_IDS = ["user", "claude_code", "model"] as const;
export type TrajectoryLaneId = (typeof TRAJECTORY_LANE_IDS)[number];

export type SequenceEventKind =
  | "user_input"
  | "thinking"
  | "assistant_text"
  | "api_request"
  | "tool_use"
  | "tool_result"
  | "system"
  | "hook"
  | "skill"
  | "jsonl_other";

export interface SequenceEvent {
  id: string;
  /** 单调递增，用于稳定排序 */
  order: number;
  timestamp: number;
  kind: SequenceEventKind;
  fromLane: TrajectoryLaneId;
  toLane: TrajectoryLaneId;
  label: string;
  subtitle?: string;
  /** 悬停/下钻用全文 */
  detail?: string;
  /** 原始 JSON 行（磁盘补充） */
  rawJsonlLine?: string;
  messageId?: number;
  /** 用于重试检测（工具名 + 输入稳定序列化） */
  toolFingerprint?: string;
  flags: {
    /** 与此前同类工具调用参数高度相似 */
    retry?: boolean;
    /** 处于高密度工具往返区段 */
    loopDense?: boolean;
    /** 与上一条事件间隔过长 */
    longGap?: boolean;
    /** 关键节点（轮次首条、错误、首条工具链） */
    key?: boolean;
    /** FCC / LLM 代理等真实 HTTP 观测（非工具结果后的推断占位） */
    observedHttp?: boolean;
  };
  /** 子代理 Task 工具下钻 */
  drilldown?: {
    type: "subagent_task";
    toolPart: ToolUsePart;
    messageId: number;
  };
}

/** 供缩略轴着色：思考 / 跑命令 / 改文件 / 其它 */
export function sequenceEventActivityCategory(ev: SequenceEvent): "thinking" | "command" | "file" | "hook" | "skill" | "model" | "other" {
  if (ev.kind === "thinking") return "thinking";
  if (ev.kind === "hook") return "hook";
  if (ev.kind === "skill") return "skill";
  if (ev.kind === "assistant_text" || ev.kind === "api_request") return "model";
  if (ev.kind === "tool_use" || ev.kind === "tool_result") {
    const t = `${ev.subtitle ?? ""} ${ev.label}`.toLowerCase();
    if (/(bash|exec|command|终端|shell)/i.test(t)) return "command";
    if (/(read|write|edit|glob|grep|文件|目录)/i.test(t)) return "file";
    if (/mcp|plugin/i.test(t)) return "hook";
    if (/task|子\s*agent|subagent/i.test(t)) return "other";
    return "other";
  }
  return "other";
}

function parseRowTimestamp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const d = Date.parse(v);
    if (!Number.isNaN(d)) return d;
  }
  return Date.now();
}

function unwrapJsonlRow(row: Record<string, unknown>): Record<string, unknown> {
  return unwrapClaudeStreamLineRoot(row);
}

function stableToolKey(name: string, input: Record<string, unknown>): string {
  try {
    return `${name.trim().toLowerCase()}::${JSON.stringify(input)}`;
  } catch {
    return `${name.trim().toLowerCase()}::`;
  }
}

function isSkillToolPart(part: ToolUsePart): boolean {
  const n = part.name.trim().toLowerCase();
  if (n === "skill" || n.includes("skill")) return true;
  const sk = part.input && typeof part.input === "object" && !Array.isArray(part.input) ? (part.input as Record<string, unknown>).skill : undefined;
  return typeof sk === "string" && sk.trim().length > 0;
}

function isSubagentTaskPart(part: ToolUsePart): boolean {
  const n = part.name.trim().toLowerCase();
  return n === "task" || n.includes("subagent");
}

function collectTextParts(parts: MessagePart[] | undefined, kind: "text" | "reasoning"): string {
  if (!parts?.length) return "";
  if (kind === "text") {
    return parts
      .filter((p): p is TextPart => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
  }
  return parts
    .filter((p): p is { type: "reasoning"; text: string } => p.type === "reasoning" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function toolParts(parts: MessagePart[] | undefined): ToolUsePart[] {
  if (!parts?.length) return [];
  return parts.filter((p): p is ToolUsePart => p.type === "tool_use");
}

/**
 * 从磁盘 JSONL 提取会话消息流之外的事件（Hooks、部分 system 行等）。
 * 与 `parseClaudeSessionJsonlLines` 正交：不替代消息列表，仅补充轨迹。
 */
export function parseTrajectoryJsonlSupplemental(lines: readonly string[]): SequenceEvent[] {
  const out: SequenceEvent[] = [];
  let order = 0;
  let lineNo = 0;
  for (const raw of lines) {
    lineNo += 1;
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const j = unwrapJsonlRow(row);
    const type = typeof j.type === "string" ? j.type : "";
    const subtype = typeof j.subtype === "string" ? j.subtype : "";
    const ts = parseRowTimestamp(j.timestamp);
    order += 1;

    if (type === "system" && subtype === "hook_response") {
      const hookEvent =
        (typeof j.hook_event === "string" && j.hook_event) ||
        (typeof j.event === "string" && j.event) ||
        (typeof j.hookEvent === "string" && j.hookEvent) ||
        "hook";
      const outcome = typeof j.outcome === "string" ? j.outcome : "";
      const output = typeof j.output === "string" ? j.output.trim() : "";
      const stderr = typeof j.stderr === "string" ? j.stderr.trim() : "";
      const detail = [output && `stdout:\n${output}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n") || JSON.stringify(j, null, 2);
      out.push({
        id: `jl-hook-${lineNo}-${order}`,
        order: 1_000_000 + lineNo,
        timestamp: ts,
        kind: "hook",
        fromLane: "claude_code",
        toLane: "claude_code",
        label: "HOOK",
        subtitle: `${hookEvent}${outcome ? ` · ${outcome}` : ""}`,
        detail,
        rawJsonlLine: trimmed,
        flags: { key: outcome === "error" },
      });
      continue;
    }

    if (type === "system" && subtype === "init") {
      const model = typeof j.model === "string" ? j.model : "";
      const cwd = typeof j.cwd === "string" ? j.cwd : "";
      out.push({
        id: `jl-init-${lineNo}-${order}`,
        order: 1_000_000 + lineNo,
        timestamp: ts,
        kind: "jsonl_other",
        fromLane: "claude_code",
        toLane: "claude_code",
        label: "会话初始化",
        subtitle: [model && `model: ${model}`, cwd && `cwd: ${cwd.slice(0, 64)}`].filter(Boolean).join(" · ") || undefined,
        detail: JSON.stringify(j, null, 2),
        rawJsonlLine: trimmed,
        flags: { key: true },
      });
      continue;
    }

    if (type === "result") {
      const text =
        (typeof j.result === "string" && j.result.trim()) ||
        (typeof j.output === "string" && j.output.trim()) ||
        "";
      if (text) {
        out.push({
          id: `jl-result-${lineNo}-${order}`,
          order: 1_000_000 + lineNo,
          timestamp: ts,
          kind: "jsonl_other",
          fromLane: "model",
          toLane: "claude_code",
          label: "RESULT",
          subtitle: text.length > 80 ? `${text.slice(0, 80)}…` : text,
          detail: text,
          rawJsonlLine: trimmed,
          flags: {},
        });
      }
    }
  }
  return out;
}

/**
 * 由当前内存中的 `ClaudeMessage[]` 构建序列图事件（与消息列表同源）。
 */
export function buildSequenceEventsFromMessages(messages: readonly ClaudeMessage[]): SequenceEvent[] {
  const events: SequenceEvent[] = [];
  let order = 0;

  const push = (ev: Omit<SequenceEvent, "order" | "flags"> & { flags?: SequenceEvent["flags"] }) => {
    order += 1;
    events.push({
      ...ev,
      order,
      flags: ev.flags ?? {},
    });
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    const prev = i > 0 ? messages[i - 1]! : null;
    const ts = msg.timestamp;

    if (msg.role === "system") {
      const raw =
        msg.parts?.filter((p): p is TextPart => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n") ?? msg.content;
      push({
        id: `sys-${msg.id}`,
        timestamp: ts,
        kind: "system",
        fromLane: "claude_code",
        toLane: "claude_code",
        label: "SYSTEM",
        subtitle: raw.trim().slice(0, 120) || undefined,
        detail: raw,
        messageId: msg.id,
        flags: { key: true },
      });
      continue;
    }

    if (msg.role === "user") {
      if (isToolOnlyUserMessage(msg)) {
        for (const part of toolParts(msg.parts)) {
          const err = part.status === "error" || Boolean(part.error?.trim());
          const body = (part.error?.trim() ? part.error : part.output) ?? "";
          push({
            id: `tr-${msg.id}-${part.id}`,
            timestamp: ts,
            kind: "tool_result",
            fromLane: "claude_code",
            toLane: "model",
            label: "TOOL_RESULT",
            subtitle: part.name ? `${part.name} · ${part.id}` : part.id,
            detail: body.trim() || undefined,
            messageId: msg.id,
            toolFingerprint: stableToolKey(part.name || "tool_result", { tool_use_id: part.id }),
            flags: { key: err },
          });
        }
      } else {
        const text = userMessagePlainTextForDisplay(msg);
        push({
          id: `usr-${msg.id}`,
          timestamp: ts,
          kind: "user_input",
          fromLane: "user",
          toLane: "claude_code",
          label: "USER",
          subtitle: text.length > 100 ? `${text.slice(0, 100)}…` : text || undefined,
          detail: text,
          messageId: msg.id,
          flags: { key: true },
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const prevIsUser = prev !== null && prev.role === "user";
      if (prevIsUser) {
        const prevIsToolUser = isToolOnlyUserMessage(prev!);
        push({
          id: `api-${msg.id}`,
          timestamp: ts - 0.5,
          kind: "api_request",
          fromLane: "claude_code",
          toLane: "model",
          label: "REQUEST",
          subtitle: prevIsToolUser ? "携带工具结果发起模型请求" : "发起模型请求",
          detail: undefined,
          messageId: msg.id,
          flags: { key: true },
        });
      }

      const reasoning = collectTextParts(msg.parts, "reasoning");
      if (reasoning.trim()) {
        push({
          id: `think-${msg.id}`,
          timestamp: ts,
          kind: "thinking",
          fromLane: "model",
          toLane: "model",
          label: "THINKING",
          subtitle: reasoning.length > 96 ? `${reasoning.slice(0, 96)}…` : reasoning,
          detail: reasoning,
          messageId: msg.id,
          flags: {},
        });
      }

      const text = collectTextParts(msg.parts, "text") || (msg.content ?? "").trim();
      if (text) {
        push({
          id: `asst-${msg.id}`,
          timestamp: ts,
          kind: "assistant_text",
          fromLane: "model",
          toLane: "claude_code",
          label: "ASSISTANT",
          subtitle: text.length > 120 ? `${text.slice(0, 120)}…` : text,
          detail: text,
          messageId: msg.id,
          flags: {},
        });
      }

      for (const part of toolParts(msg.parts)) {
        const inputStr = (() => {
          try {
            return JSON.stringify(part.input, null, 2);
          } catch {
            return String(part.input);
          }
        })();
        const detailParts = [`input:\n${inputStr}`];
        if (part.output?.trim()) detailParts.push(`output:\n${part.output}`);
        if (part.error?.trim()) detailParts.push(`error:\n${part.error}`);
        const detail = detailParts.join("\n\n---\n\n");

        if (isSkillToolPart(part)) {
          const skillName =
            (typeof part.input.skill === "string" && part.input.skill) ||
            (typeof (part.input as { skill_name?: unknown }).skill_name === "string" &&
              String((part.input as { skill_name: string }).skill_name)) ||
            part.name;
          push({
            id: `sk-${msg.id}-${part.id}`,
            timestamp: ts,
            kind: "skill",
            fromLane: "model",
            toLane: "claude_code",
            label: "SKILL",
            subtitle: typeof skillName === "string" ? skillName : String(part.name),
            detail,
            messageId: msg.id,
            toolFingerprint: stableToolKey(`skill:${part.name}`, part.input as Record<string, unknown>),
            flags: {},
          });
          continue;
        }

        if (isSubagentTaskPart(part)) {
          push({
            id: `tu-${msg.id}-${part.id}`,
            timestamp: ts,
            kind: "tool_use",
            fromLane: "model",
            toLane: "claude_code",
            label: "TOOL_USE",
            subtitle: `${part.name} · Task`,
            detail,
            messageId: msg.id,
            toolFingerprint: stableToolKey(part.name, part.input as Record<string, unknown>),
            drilldown: { type: "subagent_task", toolPart: part, messageId: msg.id },
            flags: { key: true },
          });
          continue;
        }

        push({
          id: `tu-${msg.id}-${part.id}`,
          timestamp: ts,
          kind: "tool_use",
          fromLane: "model",
          toLane: "claude_code",
          label: "TOOL_USE",
          subtitle: `${part.name}`,
          detail,
          messageId: msg.id,
          toolFingerprint: stableToolKey(part.name, part.input as Record<string, unknown>),
          flags: {},
        });
      }
    }
  }

  return events;
}

export function mergeSequenceEventsByTime(a: readonly SequenceEvent[], b: readonly SequenceEvent[]): SequenceEvent[] {
  const merged = [...a, ...b];
  merged.sort((x, y) => {
    if (x.timestamp !== y.timestamp) return x.timestamp - y.timestamp;
    return x.order - y.order;
  });
  return annotateSequenceEvents(merged);
}

/** 将 FCC HTTP trace 转为模型泳道「接口」事件（`observedHttp`）。 */
export function buildSequenceEventsFromFccTraces(entries: readonly FccTraceEntry[]): SequenceEvent[] {
  const events: SequenceEvent[] = [];
  let order = 2_000_000;
  for (const entry of entries) {
    order += 1;
    const method = (entry.method?.trim() || "POST").toUpperCase();
    const path = entry.path?.trim() || "/v1/messages";
    const status = entry.statusCode != null ? String(entry.statusCode) : "";
    const duration = entry.durationMs != null ? `${entry.durationMs}ms` : "";
    const model = entry.model?.trim() ?? "";
    const subtitleParts = [
      `${method} ${path}`,
      status || undefined,
      duration || undefined,
      model ? `model: ${model}` : undefined,
    ].filter(Boolean) as string[];
    const detail = [
      model ? `model: ${model}` : "",
      entry.anthropicRequestId?.trim() ? `request-id: ${entry.anthropicRequestId}` : "",
      entry.requestPreview?.trim() ? `request:\n${entry.requestPreview}` : "",
      entry.responsePreview?.trim() ? `response:\n${entry.responsePreview}` : "",
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    events.push({
      id: `fcc-api-${entry.id}`,
      order,
      timestamp: entry.timestampMs,
      kind: "api_request",
      fromLane: "claude_code",
      toLane: "model",
      label: "REQUEST",
      subtitle: subtitleParts.join(" · ") || "FCC HTTP",
      detail: detail || undefined,
      flags: { key: true, observedHttp: true },
    });
  }
  return events;
}

/** 同时间窗已有真实 HTTP 时移除推断的 `api_request` 占位。 */
export function suppressInferredApiRequestsWhenObserved(events: readonly SequenceEvent[]): SequenceEvent[] {
  const observedTs: number[] = [];
  for (const e of events) {
    if (e.kind === "api_request" && e.flags.observedHttp) {
      observedTs.push(e.timestamp);
    }
  }
  if (observedTs.length === 0) return [...events];
  const windowMs = 120_000;
  return events.filter((e) => {
    if (e.kind !== "api_request" || e.flags.observedHttp) return true;
    return !observedTs.some((t) => Math.abs(e.timestamp - t) <= windowMs);
  });
}

export interface BuildTrajectorySequenceOptions {
  fccTraces?: readonly FccTraceEntry[];
  llmProxyRecords?: readonly ClaudeLlmProxyRecord[];
}

export function annotateSequenceEvents(events: readonly SequenceEvent[]): SequenceEvent[] {
  const copy = events.map((e) => ({ ...e, flags: { ...e.flags } }));
  const toolKeyHistory = new Map<string, number>();
  let toolExchangeStreak = 0;

  for (let i = 0; i < copy.length; i += 1) {
    const ev = copy[i]!;
    const prev = i > 0 ? copy[i - 1]! : null;
    if (prev) {
      const delta = ev.timestamp - prev.timestamp;
      if (Number.isFinite(delta) && delta > 60_000) {
        ev.flags.longGap = true;
      }
    }

    if (ev.kind === "tool_use" || ev.kind === "tool_result") {
      toolExchangeStreak += 1;
    } else if (
      ev.kind === "api_request" ||
      ev.kind === "user_input" ||
      ev.kind === "assistant_text" ||
      ev.kind === "thinking" ||
      ev.kind === "system" ||
      ev.kind === "hook" ||
      ev.kind === "skill" ||
      ev.kind === "jsonl_other"
    ) {
      toolExchangeStreak = 0;
    }

    if (ev.kind === "tool_use" && ev.toolFingerprint) {
      const prevIdx = toolKeyHistory.get(ev.toolFingerprint);
      if (prevIdx !== undefined && i - prevIdx < 40) {
        ev.flags.retry = true;
      }
      toolKeyHistory.set(ev.toolFingerprint, i);
    }

    if (toolExchangeStreak >= 6) {
      ev.flags.loopDense = true;
    }
  }

  return copy;
}

/** 合并内存消息与磁盘 JSONL / FCC trace 后统一标注（对外主入口）。 */
export function buildTrajectorySequenceModel(
  messages: readonly ClaudeMessage[],
  supplementalLines?: readonly string[] | null,
  options?: BuildTrajectorySequenceOptions,
): SequenceEvent[] {
  let events = buildSequenceEventsFromMessages(messages);
  if (supplementalLines?.length) {
    events = mergeSequenceEventsByTime(events, parseTrajectoryJsonlSupplemental(supplementalLines));
  } else {
    events = annotateSequenceEvents(events);
  }
  const fcc = options?.fccTraces ?? [];
  const llm = options?.llmProxyRecords ?? [];
  if (fcc.length > 0 || llm.length > 0) {
    const enriched = enrichSequenceEventsWithObservedHttp(events, {
      fccTraces: fcc.length > 0 ? fcc : undefined,
      llmProxyRecords: llm.length > 0 ? llm : undefined,
    });
    events = enriched.events;
    if (enriched.unusedFccTraces.length > 0) {
      events = mergeSequenceEventsByTime(events, buildSequenceEventsFromFccTraces(enriched.unusedFccTraces));
    }
    events = suppressInferredApiRequestsWhenObserved(events);
  }

  events = events.map((e) => {
    if (e.kind !== "api_request" || e.flags.observedHttp || e.detail?.trim()) return e;
    return {
      ...e,
      detail: INFERRED_HTTP_DETAIL_PLACEHOLDER,
    };
  });

  return events;
}
