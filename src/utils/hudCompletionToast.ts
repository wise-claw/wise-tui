import type { ClaudeMessage, ClaudeSession } from "../types";
import { isHudSessionBusyStatus, resolveHudAssistantPreview } from "./wiseHudSnapshot";

export const HUD_COMPLETION_TOAST_MAX_VISIBLE = 3;
export const HUD_COMPLETION_TOAST_DURATION_MS = 4200;
export const HUD_COMPLETION_TOAST_LEAVE_MS = 240;
export const HUD_COMPLETION_TOAST_HEIGHT = 36;
export const HUD_COMPLETION_TOAST_GAP = 8;
export const HUD_COMPLETION_TOAST_MESSAGE_MAX_LEN = 42;

export type HudCompletionToastKind = "success" | "error";

export interface HudCompletionToastItem {
  id: string;
  sessionId: string;
  kind: HudCompletionToastKind;
  message: string;
}

export type HudCompletionToastPhase = "visible" | "leaving";

export interface HudCompletionToastView extends HudCompletionToastItem {
  phase: HudCompletionToastPhase;
}

export interface HudToastBoard {
  visible: HudCompletionToastView[];
  queued: HudCompletionToastItem[];
}

export const EMPTY_HUD_TOAST_BOARD: HudToastBoard = {
  visible: [],
  queued: [],
};

export type HudCompletionSessionProbe = Pick<ClaudeSession, "id" | "status"> & {
  messages?: readonly ClaudeMessage[];
};

let toastSeq = 0;

function nextToastId(sessionId: string): string {
  toastSeq += 1;
  return `${sessionId}:${toastSeq}`;
}

function clipLabel(text: string, maxLen: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

export function hudToastStackExtraHeight(renderedCount: number): number {
  const n = Math.max(0, Math.floor(renderedCount));
  if (n === 0) return 0;
  return n * HUD_COMPLETION_TOAST_HEIGHT + n * HUD_COMPLETION_TOAST_GAP;
}

export function formatHudCompletionToast(session: HudCompletionSessionProbe): HudCompletionToastItem {
  const kind: HudCompletionToastKind = session.status === "error" ? "error" : "success";
  const preview = resolveHudAssistantPreview(session.messages, HUD_COMPLETION_TOAST_MESSAGE_MAX_LEN);
  const message =
    kind === "error"
      ? "这轮没跑通，可以再试一次。"
      : preview || "已经完成，可以继续发任务。";
  return {
    id: nextToastId(session.id),
    sessionId: session.id,
    kind,
    message,
  };
}

export function collectHudSessionCompletions(
  previousStatusById: ReadonlyMap<string, string>,
  sessions: ReadonlyArray<HudCompletionSessionProbe>,
): HudCompletionToastItem[] {
  const items: HudCompletionToastItem[] = [];
  for (const session of sessions) {
    const prevStatus = previousStatusById.get(session.id);
    if (!prevStatus || !isHudSessionBusyStatus(prevStatus)) continue;
    if (isHudSessionBusyStatus(session.status)) continue;
    if (session.status === "cancelled") continue;
    items.push(formatHudCompletionToast(session));
  }
  return items;
}

export function sessionStatusMap(
  sessions: ReadonlyArray<{ id: string; status: string }>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const session of sessions) {
    next.set(session.id, session.status);
  }
  return next;
}

function occupyingCount(visible: readonly HudCompletionToastView[]): number {
  let count = 0;
  for (const toast of visible) {
    if (toast.phase !== "leaving") count += 1;
  }
  return count;
}

export function refillHudToastBoard(
  board: HudToastBoard,
  maxVisible = HUD_COMPLETION_TOAST_MAX_VISIBLE,
): HudToastBoard {
  const visible = [...board.visible];
  const queued = [...board.queued];
  const cap = Math.max(1, Math.floor(maxVisible));
  while (occupyingCount(visible) < cap && queued.length > 0) {
    const item = queued.shift()!;
    visible.push({ ...item, phase: "visible" });
  }
  return { visible, queued };
}

export function enqueueHudCompletionToasts(
  board: HudToastBoard,
  incoming: readonly HudCompletionToastItem[],
  maxVisible = HUD_COMPLETION_TOAST_MAX_VISIBLE,
): HudToastBoard {
  if (incoming.length === 0) return board;
  return refillHudToastBoard(
    {
      visible: board.visible,
      queued: [...board.queued, ...incoming],
    },
    maxVisible,
  );
}

export function beginHudToastLeave(board: HudToastBoard, id: string): HudToastBoard {
  let changed = false;
  const visible = board.visible.map((toast) => {
    if (toast.id !== id || toast.phase === "leaving") return toast;
    changed = true;
    return { ...toast, phase: "leaving" as const };
  });
  return changed ? { visible, queued: board.queued } : board;
}

export function removeHudToast(
  board: HudToastBoard,
  id: string,
  maxVisible = HUD_COMPLETION_TOAST_MAX_VISIBLE,
): HudToastBoard {
  const visible = board.visible.filter((toast) => toast.id !== id);
  if (visible.length === board.visible.length) {
    return refillHudToastBoard(board, maxVisible);
  }
  return refillHudToastBoard({ visible, queued: board.queued }, maxVisible);
}

export function parseHudCompletionToastPayload(raw: unknown): HudCompletionToastItem[] {
  if (!raw || typeof raw !== "object") return [];
  const itemsRaw = (raw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) return [];
  const items: HudCompletionToastItem[] = [];
  for (const item of itemsRaw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Partial<HudCompletionToastItem>;
    if (typeof value.id !== "string" || !value.id.trim()) continue;
    if (typeof value.sessionId !== "string" || !value.sessionId.trim()) continue;
    if (value.kind !== "success" && value.kind !== "error") continue;
    if (typeof value.message !== "string") continue;
    const message = clipLabel(value.message, HUD_COMPLETION_TOAST_MESSAGE_MAX_LEN + 8);
    if (!message) continue;
    items.push({
      id: value.id.trim(),
      sessionId: value.sessionId.trim(),
      kind: value.kind,
      message,
    });
  }
  return items;
}
