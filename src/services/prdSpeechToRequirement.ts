import type { PrdDraftPayload, PrdRequirementHistoryItem } from "./prdDraftStore";
import { loadPrdDraft, savePrdDraft } from "./prdDraftStore";

export interface SpeechToRequirementScope {
  /** 应用设置桶：通常为侧栏 `activeProjectId`；无项目时为 null（`__none__` 桶）。 */
  projectScopeId: string | null;
  linkedProjectId: string | null;
  linkedRepositoryId: number | null;
  contextMode: "project" | "repository";
}

export interface SpeechToRequirementTurn {
  role: "user" | "assistant";
  text: string;
  /** 用于段落标题展示 */
  at?: number;
}

function createRequirementHistoryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req-${crypto.randomUUID()}`;
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function pickPinnedOrLatest(requirements: PrdRequirementHistoryItem[]): PrdRequirementHistoryItem | null {
  if (requirements.length === 0) return null;
  const sorted = [...requirements].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.find((item) => item.isPinned) ?? sorted[0] ?? null;
}

function formatSpeechRequirementName(at: number): string {
  const stamp = new Date(at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `谈话需求 ${stamp}`;
}

function formatTurnBlock(turn: SpeechToRequirementTurn): string {
  const body = turn.text.trim();
  if (!body) return "";
  const at = turn.at ?? Date.now();
  const time = new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const speaker = turn.role === "user" ? "用户" : "助手";
  return `\n\n### ${speaker} · ${time}\n\n${body}`;
}

function appendToRequirementInput(current: string, block: string): string {
  const base = current.trimEnd();
  if (!base) return block.trimStart();
  return `${base}${block}`;
}

function buildRequirementItem(
  scope: SpeechToRequirementScope,
  id: string,
  name: string,
  inputValue: string,
  createdAt: number,
  updatedAt: number,
  isPinned = false,
): PrdRequirementHistoryItem {
  return {
    id,
    requirementDisplayName: name,
    isPinned,
    inputValue,
    originalInputValue: null,
    contextMode: scope.contextMode,
    linkedProjectId: scope.linkedProjectId,
    linkedRepositoryId: scope.linkedRepositoryId,
    createdAt,
    updatedAt,
  };
}

/**
 * 将单条会话发言追加到当前项目桶下的 PRD 需求草稿（与需求拆分助手「新增 + 保存」同一存储）。
 */
export async function appendConversationTurnToPrdRequirement(
  scope: SpeechToRequirementScope,
  turn: SpeechToRequirementTurn,
): Promise<{ requirementId: string; created: boolean } | null> {
  const block = formatTurnBlock(turn);
  if (!block) return null;

  const projectScopeId = scope.projectScopeId?.trim() || scope.linkedProjectId?.trim() || null;
  const draft = (await loadPrdDraft(projectScopeId)) ?? null;
  const now = turn.at ?? Date.now();

  const historical = (draft?.requirements ?? []).filter(
    (item) => item.requirementDisplayName.trim().length > 0,
  );
  const storedCurrentId = draft?.currentRequirementId?.trim();
  const pinnedOrLatest = pickPinnedOrLatest(historical);
  const storedCurrent = storedCurrentId
    ? historical.find((item) => item.id === storedCurrentId) ?? null
    : null;
  const active = storedCurrent ?? pinnedOrLatest;

  let created = false;
  let nextActiveId: string;
  let nextHistory: PrdRequirementHistoryItem[];

  if (active) {
    nextActiveId = active.id;
    const updated = buildRequirementItem(
      scope,
      active.id,
      active.requirementDisplayName,
      appendToRequirementInput(active.inputValue, block),
      active.createdAt,
      now,
      active.isPinned ?? false,
    );
    nextHistory = [updated, ...historical.filter((item) => item.id !== active.id)];
  } else {
    created = true;
    nextActiveId = createRequirementHistoryId();
    const createdItem = buildRequirementItem(
      scope,
      nextActiveId,
      formatSpeechRequirementName(now),
      block.trimStart(),
      now,
      now,
    );
    nextHistory = [createdItem, ...historical];
  }

  const selected = nextHistory.find((item) => item.id === nextActiveId) ?? null;
  const payload: PrdDraftPayload = {
    inputValue: selected?.inputValue ?? block.trimStart(),
    originalInputValue: selected?.originalInputValue ?? null,
    contextMode: selected?.contextMode ?? scope.contextMode,
    linkedProjectId: selected?.linkedProjectId ?? scope.linkedProjectId,
    linkedRepositoryId: selected?.linkedRepositoryId ?? scope.linkedRepositoryId,
    requirementDisplayName: selected?.requirementDisplayName ?? formatSpeechRequirementName(now),
    currentRequirementId: nextActiveId,
    requirements: nextHistory,
  };

  await savePrdDraft(projectScopeId, payload);
  return { requirementId: nextActiveId, created };
}
