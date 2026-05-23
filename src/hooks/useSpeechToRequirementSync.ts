import { useEffect, useRef } from "react";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  hasRenderableChatMessageBody,
  isToolOnlyUserMessage,
  userMessagePlainTextForDisplay,
} from "../utils/claudeChatMessageDisplay";
import {
  appendConversationTurnToPrdRequirement,
  type SpeechToRequirementScope,
} from "../services/prdSpeechToRequirement";

function assistantMessagePlainText(msg: ClaudeMessage): string {
  const fromParts = msg.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
  if (fromParts?.trim()) return fromParts.trim();
  return (msg.content ?? "").trim();
}

function messagePlainTextForCapture(msg: ClaudeMessage): string {
  if (msg.role === "user") return userMessagePlainTextForDisplay(msg);
  if (msg.role === "assistant") return assistantMessagePlainText(msg);
  return "";
}

function lastRenderableMessageIndex(messages: readonly ClaudeMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (hasRenderableChatMessageBody(messages[i]!)) return i;
  }
  return -1;
}

/**
 * 开启「录音转需求」后，将本会话新增的用户/助手可展示消息追加到 PRD 需求草稿。
 */
export function useSpeechToRequirementSync(
  enabled: boolean,
  scope: SpeechToRequirementScope | null,
  session: ClaudeSession,
): void {
  const syncedIdsRef = useRef<Set<number>>(new Set());
  const seededSessionRef = useRef<string | null>(null);

  useEffect(() => {
    syncedIdsRef.current = new Set();
    seededSessionRef.current = null;
  }, [session.id]);

  useEffect(() => {
    if (!enabled) {
      seededSessionRef.current = null;
      return;
    }
    if (seededSessionRef.current === session.id) return;
    seededSessionRef.current = session.id;
    for (const msg of session.messages) {
      syncedIdsRef.current.add(msg.id);
    }
  }, [enabled, session.id, session.messages]);

  useEffect(() => {
    if (!enabled || !scope) return;

    const lastRenderableIdx = lastRenderableMessageIndex(session.messages);
    const sessionBusy = session.status === "running" || session.status === "connecting";

    for (let i = 0; i < session.messages.length; i += 1) {
      const msg = session.messages[i]!;
      if (syncedIdsRef.current.has(msg.id)) continue;
      if (!hasRenderableChatMessageBody(msg)) continue;
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      if (msg.role === "user" && isToolOnlyUserMessage(msg)) continue;

      if (msg.role === "assistant") {
        if (sessionBusy) continue;
        if (i !== lastRenderableIdx) continue;
      }

      const text = messagePlainTextForCapture(msg);
      if (!text.trim()) {
        syncedIdsRef.current.add(msg.id);
        continue;
      }

      syncedIdsRef.current.add(msg.id);
      void appendConversationTurnToPrdRequirement(scope, {
        role: msg.role,
        text,
        at: msg.timestamp,
      }).catch(() => {
        syncedIdsRef.current.delete(msg.id);
      });
    }
  }, [enabled, scope, session.messages, session.status]);
}

export function buildSpeechToRequirementScope(input: {
  activeProjectId: string | null | undefined;
  activeRepositoryId: number | null | undefined;
}): SpeechToRequirementScope | null {
  const linkedProjectId = input.activeProjectId?.trim() || null;
  const linkedRepositoryId =
    typeof input.activeRepositoryId === "number" && Number.isFinite(input.activeRepositoryId)
      ? input.activeRepositoryId
      : null;
  if (!linkedProjectId && linkedRepositoryId == null) return null;
  return {
    projectScopeId: linkedProjectId,
    linkedProjectId,
    linkedRepositoryId,
    contextMode: linkedProjectId ? "project" : "repository",
  };
}
