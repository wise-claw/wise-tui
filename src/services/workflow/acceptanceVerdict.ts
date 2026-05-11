export type AcceptanceDecision = "pass" | "reject";

export const WORKFLOW_ACCEPTANCE_VERDICT_KEY = "workflowAcceptanceVerdict" as const;

/** 与 `design/llm-structured-decision-pipeline/verdict-payload.schema.json` 对齐（运行时校验，不依赖 Ajv）。 */
export type WorkflowAcceptanceVerdictPayload = {
  schemaVersion: number;
  workflowAcceptanceVerdict: "approve" | "reject";
  taskId: string;
  nodeId: string;
  rationale?: string;
};

export interface VerdictResolutionContext {
  taskId: string;
  graphNodeId: string;
}

export type AcceptanceVerdictGate = "schema" | "inferred";

export function validateWorkflowAcceptanceVerdictPayload(
  input: unknown,
): { ok: true; value: WorkflowAcceptanceVerdictPayload } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["not_object"] };
  }
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.schemaVersion !== "number" || !Number.isInteger(o.schemaVersion) || o.schemaVersion < 1) {
    errors.push("schemaVersion");
  }
  if (o.workflowAcceptanceVerdict !== "approve" && o.workflowAcceptanceVerdict !== "reject") {
    errors.push("workflowAcceptanceVerdict");
  }
  if (typeof o.taskId !== "string" || !o.taskId.trim()) {
    errors.push("taskId");
  }
  if (typeof o.nodeId !== "string" || !o.nodeId.trim()) {
    errors.push("nodeId");
  }
  if (o.rationale !== undefined && typeof o.rationale !== "string") {
    errors.push("rationale");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const value: WorkflowAcceptanceVerdictPayload = {
    schemaVersion: o.schemaVersion as number,
    workflowAcceptanceVerdict: o.workflowAcceptanceVerdict as "approve" | "reject",
    taskId: (o.taskId as string).trim(),
    nodeId: (o.nodeId as string).trim(),
  };
  if (typeof o.rationale === "string" && o.rationale.trim()) {
    value.rationale = o.rationale.trim();
  }
  return { ok: true, value };
}

/** 对已解析对象做 schema 形状校验（`parseAcceptanceVerdictPayload` 别名语义）。 */
export function parseAcceptanceVerdictPayload(
  input: unknown,
): { ok: true; value: WorkflowAcceptanceVerdictPayload } | { ok: false; errors: string[] } {
  return validateWorkflowAcceptanceVerdictPayload(input);
}

const ACCEPTANCE_VERDICT_KEY_SCAN_MAX = 4_000_000;
const ACCEPTANCE_STRUCTURED_TAIL_MAX = 1_000_000;
const ACCEPTANCE_EXPLICIT_ZH_TAIL_MAX = 1_000_000;
const ACCEPTANCE_WEAK_SIGNAL_TAIL_MAX = 120_000;

function normalizeStructuredVerdictToken(raw: string): AcceptanceDecision | null {
  const s = raw.trim().toLowerCase();
  if (["approve", "approved", "pass", "accept", "yes", "ok"].includes(s)) return "pass";
  if (["reject", "rejected", "fail", "deny", "no"].includes(s)) return "reject";
  const zh = raw.trim();
  if (zh === "通过") return "pass";
  if (zh === "驳回") return "reject";
  return null;
}

function verdictFromAcceptanceJsonObject(obj: Record<string, unknown>): AcceptanceDecision | null {
  const en = obj[WORKFLOW_ACCEPTANCE_VERDICT_KEY] ?? obj.verdict ?? obj.decision;
  if (typeof en === "string") {
    const d = normalizeStructuredVerdictToken(en);
    if (d) return d;
  }
  const zh = obj["验收结论"];
  if (typeof zh === "string") {
    return normalizeStructuredVerdictToken(zh);
  }
  return null;
}

function mergeVerdictPayloadForGate(
  candidate: Record<string, unknown>,
  ctx: VerdictResolutionContext,
): unknown {
  const mapped = verdictFromAcceptanceJsonObject(candidate);
  const rawVk = candidate[WORKFLOW_ACCEPTANCE_VERDICT_KEY];
  let workflowAcceptanceVerdict: "approve" | "reject" | null = null;
  if (rawVk === "approve" || rawVk === "reject") {
    workflowAcceptanceVerdict = rawVk;
  } else if (mapped === "pass") {
    workflowAcceptanceVerdict = "approve";
  } else if (mapped === "reject") {
    workflowAcceptanceVerdict = "reject";
  }
  if (!workflowAcceptanceVerdict) {
    return null;
  }

  const ct = typeof candidate.taskId === "string" ? candidate.taskId.trim() : "";
  const cn = typeof candidate.nodeId === "string" ? candidate.nodeId.trim() : "";
  if (ct && ct !== ctx.taskId) {
    return null;
  }
  if (cn && cn !== ctx.graphNodeId) {
    return null;
  }

  const schemaVersion =
    typeof candidate.schemaVersion === "number" &&
    Number.isInteger(candidate.schemaVersion) &&
    candidate.schemaVersion >= 1
      ? candidate.schemaVersion
      : 1;

  const merged: Record<string, unknown> = {
    schemaVersion,
    workflowAcceptanceVerdict,
    taskId: ctx.taskId,
    nodeId: ctx.graphNodeId,
  };
  if (typeof candidate.rationale === "string" && candidate.rationale.trim()) {
    merged.rationale = candidate.rationale.trim();
  }
  return merged;
}

function collectVerdictJsonObjectsFromFences(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  for (const m of text.matchAll(fenceRe)) {
    const inner = m[1]!.trim();
    if (!inner.startsWith("{")) continue;
    try {
      const obj = JSON.parse(inner) as Record<string, unknown>;
      if (verdictFromAcceptanceJsonObject(obj) !== null) {
        out.push(obj);
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
  return out;
}

function collectVerdictJsonObjectsFromLines(text: string): Record<string, unknown>[] {
  const structuredTail =
    text.length > ACCEPTANCE_STRUCTURED_TAIL_MAX ? text.slice(-ACCEPTANCE_STRUCTURED_TAIL_MAX) : text;
  const lineCandidates = structuredTail
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"));
  const out: Record<string, unknown>[] = [];
  for (const line of lineCandidates) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (verdictFromAcceptanceJsonObject(obj) !== null) {
        out.push(obj);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * 先尝试从可解析 JSON（围栏或单行）构造与 `verdict-payload.schema.json` 一致的 payload 并通过校验（**schema 门闸**）；
 * 否则回退到 `inferAcceptanceDecisionFromOutput`（**推断门闸**，兼容旧输出）。
 */
export function resolveAcceptanceVerdictWithGate(
  text: string,
  ctx: VerdictResolutionContext,
):
  | { ok: true; gate: "schema"; decision: AcceptanceDecision; payload: WorkflowAcceptanceVerdictPayload }
  | { ok: true; gate: "inferred"; decision: AcceptanceDecision }
  | { ok: false } {
  const mergedCandidates = [...collectVerdictJsonObjectsFromFences(text), ...collectVerdictJsonObjectsFromLines(text)];
  for (let i = mergedCandidates.length - 1; i >= 0; i -= 1) {
    const merged = mergeVerdictPayloadForGate(mergedCandidates[i]!, ctx);
    if (merged === null) {
      continue;
    }
    const validated = validateWorkflowAcceptanceVerdictPayload(merged);
    if (validated.ok) {
      return {
        ok: true,
        gate: "schema",
        decision: validated.value.workflowAcceptanceVerdict === "approve" ? "pass" : "reject",
        payload: validated.value,
      };
    }
  }
  const inferred = inferAcceptanceDecisionFromOutput(text);
  if (inferred) {
    return { ok: true, gate: "inferred", decision: inferred };
  }
  return { ok: false };
}

function inferVerdictFromKeyPatternsInText(tailText: string): AcceptanceDecision | null {
  const tail = tailText;
  if (!tail.trim()) return null;
  let bestEnd = -1;
  let best: AcceptanceDecision | null = null;
  const vk = WORKFLOW_ACCEPTANCE_VERDICT_KEY;
  const patterns: RegExp[] = [
    new RegExp(`"${vk}"\\s*:\\s*"([^"]+)"`, "gi"),
    new RegExp(`"${vk}"\\s*:\\s*'(\\\\.|[^']*)'`, "gi"),
    new RegExp(`"${vk}"\\s*:\\s*(approve|reject)(?=\\s*[,}\\]\\r\\n]|$)`, "gi"),
    new RegExp(`'${vk}'\\s*:\\s*'(\\\\.|[^']*)'`, "gi"),
    new RegExp(`'${vk}'\\s*:\\s*"([^"]+)"`, "gi"),
    /"验收结论"\s*:\s*"([^"]+)"/gi,
    /"验收结论"\s*:\s*(通过|驳回)(?=\s*[,}\]\r\n]|$)/gi,
    /"decision"\s*:\s*"([^"]+)"/gi,
    /"decision"\s*:\s*(approve|reject|pass)(?=\s*[,}\]\r\n]|$)/gi,
    /['"]decision['"]\s*:\s*['"]([^'"]+)['"]/gi,
  ];
  for (const re of patterns) {
    for (const m of tail.matchAll(re)) {
      const end = m.index! + m[0].length;
      const token = m[1]!.trim();
      const d = normalizeStructuredVerdictToken(token);
      if (d && end >= bestEnd) {
        bestEnd = end;
        best = d;
      }
    }
  }
  return best;
}

function inferAcceptanceDecisionFromStructuredJson(text: string): AcceptanceDecision | null {
  const t = text.trim();
  if (!t) return null;

  let lastFromFence: AcceptanceDecision | null = null;
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  for (const m of t.matchAll(fenceRe)) {
    const inner = m[1]!.trim();
    if (!inner.startsWith("{")) continue;
    try {
      const obj = JSON.parse(inner) as Record<string, unknown>;
      const d = verdictFromAcceptanceJsonObject(obj);
      if (d) lastFromFence = d;
    } catch {
      // ignore malformed JSON
    }
  }
  if (lastFromFence) return lastFromFence;

  const keyScanTail = t.length > ACCEPTANCE_VERDICT_KEY_SCAN_MAX ? t.slice(-ACCEPTANCE_VERDICT_KEY_SCAN_MAX) : t;
  const fromKeys = inferVerdictFromKeyPatternsInText(keyScanTail);
  if (fromKeys) return fromKeys;

  const structuredTail = t.length > ACCEPTANCE_STRUCTURED_TAIL_MAX ? t.slice(-ACCEPTANCE_STRUCTURED_TAIL_MAX) : t;
  const lineCandidates = structuredTail
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"));
  for (let i = lineCandidates.length - 1; i >= 0; i -= 1) {
    try {
      const obj = JSON.parse(lineCandidates[i]!) as Record<string, unknown>;
      const d = verdictFromAcceptanceJsonObject(obj);
      if (d) return d;
    } catch {
      // continue
    }
  }

  return inferVerdictFromKeyPatternsInText(structuredTail);
}

export function inferAcceptanceDecisionFromOutput(text: string): AcceptanceDecision | null {
  const t = text.trim();
  if (!t) return null;

  const fromJson = inferAcceptanceDecisionFromStructuredJson(t);
  if (fromJson) return fromJson;

  const region = t.length > ACCEPTANCE_EXPLICIT_ZH_TAIL_MAX ? t.slice(-ACCEPTANCE_EXPLICIT_ZH_TAIL_MAX) : t;
  const passExplicit =
    /验收结论\s*[:：]\s*通过|「\s*验收结论\s*[:：]\s*通过|结论\s*[:：]\s*通过|验收结果\s*[:：]\s*为?\s*通过|最终结论\s*[:：]\s*通过/gi;
  const rejectExplicit =
    /验收结论\s*[:：]\s*驳回|「\s*验收结论\s*[:：]\s*驳回|结论\s*[:：]\s*驳回|验收结果\s*[:：]\s*为?\s*驳回|最终结论\s*[:：]\s*驳回/gi;
  let bestPassEnd = -1;
  let bestRejectEnd = -1;
  for (const m of region.matchAll(passExplicit)) {
    bestPassEnd = Math.max(bestPassEnd, m.index! + m[0].length);
  }
  for (const m of region.matchAll(rejectExplicit)) {
    bestRejectEnd = Math.max(bestRejectEnd, m.index! + m[0].length);
  }
  if (bestPassEnd >= 0 || bestRejectEnd >= 0) {
    if (bestPassEnd > bestRejectEnd) return "pass";
    if (bestRejectEnd > bestPassEnd) return "reject";
    return null;
  }

  const jsonDecisionQuoted = /["']decision["']\s*:\s*["']([^"']+)["']/gi;
  const jsonDecisionBare = /["']decision["']\s*:\s*(approve|reject|pass|通过|驳回)(?=\s*[,}\]\r\n]|$)/gi;
  const decisionScanTail = t.length > ACCEPTANCE_STRUCTURED_TAIL_MAX ? t.slice(-ACCEPTANCE_STRUCTURED_TAIL_MAX) : t;
  let jsonEnd = -1;
  let jsonOut: AcceptanceDecision | null = null;
  for (const m of decisionScanTail.matchAll(jsonDecisionQuoted)) {
    const end = m.index! + m[0].length;
    const v = m[1]!.toLowerCase();
    let d: AcceptanceDecision | null = null;
    if (v === "pass" || v === "approve" || v === "approved" || v === "通过") d = "pass";
    else if (v === "reject" || v === "rejected" || v === "驳回") d = "reject";
    if (d && end >= jsonEnd) {
      jsonEnd = end;
      jsonOut = d;
    }
  }
  for (const m of decisionScanTail.matchAll(jsonDecisionBare)) {
    const end = m.index! + m[0].length;
    const d = normalizeStructuredVerdictToken(m[1]!);
    if (d && end >= jsonEnd) {
      jsonEnd = end;
      jsonOut = d;
    }
  }
  if (jsonOut) return jsonOut;

  const tail = t.slice(Math.max(0, t.length - ACCEPTANCE_WEAK_SIGNAL_TAIL_MAX));
  if (/\bREJECT\b|\bFAIL\b/.test(tail) && !/\bPASS\b|\bAPPROVE\b/.test(tail)) {
    return "reject";
  }
  if (/\bPASS\b|\bAPPROVE\b/.test(tail)) {
    return "pass";
  }
  if (/\b驳回\b/.test(tail) && !/\b通过\b/.test(tail)) {
    return "reject";
  }
  if (/\b通过\b/.test(tail) && !/\b驳回\b/.test(tail)) {
    return "pass";
  }
  return null;
}
