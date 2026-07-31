/**
 * Bridge Cursor ACP control events into notificationHub so PermissionDock /
 * QuestionDock can render without a third Modal stack.
 */
import { notificationHub } from "../notifications/hub";
import type { PermissionRequest, QuestionRequest } from "../types";
import {
  onCursorAcpAskQuestion,
  onCursorAcpCreatePlan,
  onCursorAcpPermissionRequest,
  type CursorAcpAskQuestionPayload,
  type CursorAcpCreatePlanPayload,
  type CursorAcpPermissionRequestPayload,
} from "./cursorAcp";

function mapPermission(payload: CursorAcpPermissionRequestPayload): PermissionRequest {
  return {
    id: payload.requestId,
    tool: payload.toolName || "Tool",
    description: payload.description || "",
    controlSubtype: "permission",
  };
}

/** Encode ACP RPC request id + question id so respond can rebuild the wire outcome. */
export function encodeCursorAcpQuestionRequestId(
  requestId: string,
  questionId: string,
): string {
  return `acp-q:${requestId}::${questionId}`;
}

export function decodeCursorAcpQuestionRequestId(
  encoded: string,
): { requestId: string; questionId: string } | null {
  if (!encoded.startsWith("acp-q:")) return null;
  const rest = encoded.slice("acp-q:".length);
  const sep = rest.indexOf("::");
  if (sep <= 0) return null;
  return {
    requestId: rest.slice(0, sep),
    questionId: rest.slice(sep + 2),
  };
}

function mapAskQuestion(payload: CursorAcpAskQuestionPayload): QuestionRequest | null {
  const first = payload.questions?.[0];
  if (!first) {
    return {
      id: encodeCursorAcpQuestionRequestId(payload.requestId, payload.requestId),
      question: payload.title?.trim() || "请选择",
      options: [],
    };
  }
  return {
    id: encodeCursorAcpQuestionRequestId(payload.requestId, first.id),
    question: first.prompt || payload.title?.trim() || "请选择",
    options: (first.options ?? []).map((opt) => ({
      value: opt.id,
      label: opt.label,
    })),
    multiSelect: Boolean(first.allowMultiple),
  };
}

function mapCreatePlan(payload: CursorAcpCreatePlanPayload): PermissionRequest {
  const parts = [
    payload.name?.trim(),
    payload.overview?.trim(),
    typeof payload.plan === "string" ? payload.plan.trim() : "",
  ].filter(Boolean);
  return {
    id: payload.requestId,
    tool: "ExitPlanMode",
    description: parts.join("\n\n") || "确认执行计划",
    controlSubtype: "permission",
  };
}

/** Start listening; returns a disposer. Safe to call once at app bootstrap. */
export async function startCursorAcpControlBridge(): Promise<() => void> {
  const unsubs = await Promise.all([
    onCursorAcpPermissionRequest((payload) => {
      const sid = payload.sessionId?.trim();
      if (!sid) return;
      notificationHub.setPermissionRequest(sid, mapPermission(payload));
    }),
    onCursorAcpAskQuestion((payload) => {
      const sid = payload.sessionId?.trim();
      if (!sid) return;
      const q = mapAskQuestion(payload);
      if (q) notificationHub.setQuestionRequest(sid, q);
    }),
    onCursorAcpCreatePlan((payload) => {
      const sid = payload.sessionId?.trim();
      if (!sid) return;
      notificationHub.setPermissionRequest(sid, mapCreatePlan(payload));
    }),
  ]);
  return () => {
    for (const u of unsubs) u();
  };
}
