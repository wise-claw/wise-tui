import { useSyncExternalStore } from "react";
import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";
import {
  parseCockpitConversationRecord,
  type CockpitConversationRecord,
  type CockpitRunStatus,
} from "../utils/cockpitConversation";

export const COCKPIT_CONVERSATION_STORAGE_KEY = "wise.cockpit.conversations.v1";
const MAX_RECORDS = 40;

export interface CockpitConversationState {
  records: CockpitConversationRecord[];
  lastAssistantId: string | null;
}

let snapshot: CockpitConversationState = { records: [], lastAssistantId: null };
const listeners = new Set<() => void>();
let persistGeneration = 0;

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

function parseState(raw: unknown): CockpitConversationState {
  if (!raw || typeof raw !== "object") return { records: [], lastAssistantId: null };
  const o = raw as Record<string, unknown>;
  const records = Array.isArray(o.records)
    ? o.records.map(parseCockpitConversationRecord).filter((item): item is CockpitConversationRecord => item != null)
    : [];
  const lastAssistantId =
    typeof o.lastAssistantId === "string" && o.lastAssistantId.trim() ? o.lastAssistantId.trim() : null;
  return { records, lastAssistantId };
}

async function persist(next: CockpitConversationState): Promise<void> {
  persistGeneration += 1;
  snapshot = next;
  emit();
  await setAppSettingJson(COCKPIT_CONVERSATION_STORAGE_KEY, next);
}

export function getCockpitConversationSnapshot(): CockpitConversationState {
  return snapshot;
}

export function subscribeCockpitConversations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function hydrateCockpitConversations(): Promise<CockpitConversationState> {
  const generation = persistGeneration;
  const raw = await getAppSettingJson<unknown>(COCKPIT_CONVERSATION_STORAGE_KEY);
  if (generation !== persistGeneration) return snapshot;
  snapshot = parseState(raw);
  emit();
  return snapshot;
}

export async function recordCockpitConversation(
  input: Omit<CockpitConversationRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<CockpitConversationRecord> {
  const now = Date.now();
  const record: CockpitConversationRecord = {
    ...input,
    id: input.id?.trim() || newCockpitConversationId(),
    createdAt: now,
    updatedAt: now,
  };
  const rest = snapshot.records.filter((item) => item.id !== record.id);
  await persist({
    lastAssistantId: record.assistantId,
    records: [record, ...rest].slice(0, MAX_RECORDS),
  });
  return record;
}

export async function patchCockpitConversation(
  id: string,
  patch: Partial<Pick<CockpitConversationRecord, "sessionId" | "status" | "artifactPaths" | "title">>,
): Promise<CockpitConversationRecord | null> {
  const trimmed = id.trim();
  const current = snapshot.records.find((item) => item.id === trimmed);
  if (!current) return null;
  const next: CockpitConversationRecord = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  await persist({
    lastAssistantId: snapshot.lastAssistantId,
    records: snapshot.records.map((item) => (item.id === trimmed ? next : item)),
  });
  return next;
}

export function listCockpitConversationsForRepository(repositoryPath: string): CockpitConversationRecord[] {
  const path = repositoryPath.trim();
  if (!path) return [];
  return snapshot.records.filter((item) => item.repositoryPath === path);
}

export function latestCockpitConversationForAssistant(assistantId: string): CockpitConversationRecord | null {
  const id = assistantId.trim();
  if (!id) return null;
  return snapshot.records.find((item) => item.assistantId === id) ?? null;
}

export function runningCockpitConversations(): CockpitConversationRecord[] {
  return snapshot.records.filter((item) => item.status === "running" && item.sessionId);
}

export function useCockpitConversations(): CockpitConversationState {
  return useSyncExternalStore(
    subscribeCockpitConversations,
    getCockpitConversationSnapshot,
    getCockpitConversationSnapshot,
  );
}

export function cockpitRunStatusFromSessionStatus(status: string): CockpitRunStatus {
  if (status === "error" || status === "cancelled") return "failed";
  if (status === "completed") return "ok";
  return "running";
}

function newCockpitConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ck-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** @internal test helper */
export function resetCockpitConversationStoreForTests(): void {
  snapshot = { records: [], lastAssistantId: null };
  listeners.clear();
  persistGeneration = 0;
}
