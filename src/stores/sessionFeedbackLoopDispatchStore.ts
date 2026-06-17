import type { FeedbackLoopDispatchKind } from "../utils/sessionFeedbackLoopDispatch";

export type FeedbackLoopDispatchStatus = "running" | "completed" | "failed";

export interface SessionFeedbackLoopDispatchRecord {
  dispatchId: string;
  anchorSessionId: string;
  workerSessionId: string;
  repositoryPath: string;
  kind: FeedbackLoopDispatchKind;
  cycleIndex?: number;
  previewText: string;
  status: FeedbackLoopDispatchStatus;
  createdAt: number;
  completedAt?: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** anchorSessionId → records（新记录在前） */
const recordsByAnchor = new Map<string, SessionFeedbackLoopDispatchRecord[]>();

const MAX_RECORDS_PER_ANCHOR = 24;

const EMPTY_SNAPSHOT: SessionFeedbackLoopDispatchRecord[] = [];

const anchorSnapshotById = new Map<
  string,
  { digest: string; snapshot: SessionFeedbackLoopDispatchRecord[] }
>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

function digestRecords(records: readonly SessionFeedbackLoopDispatchRecord[]): string {
  return records
    .map((r) =>
      [
        r.dispatchId,
        r.workerSessionId,
        r.kind,
        r.status,
        String(r.createdAt),
        String(r.completedAt ?? 0),
      ].join(":"),
    )
    .join("|");
}

function listRecordsUncached(anchorSessionId: string): SessionFeedbackLoopDispatchRecord[] {
  return recordsByAnchor.get(anchorSessionId.trim()) ?? [];
}

function publishAnchorSnapshot(anchorSessionId: string): void {
  const records = listRecordsUncached(anchorSessionId);
  const digest = digestRecords(records);
  const cached = anchorSnapshotById.get(anchorSessionId);
  if (cached?.digest === digest) return;
  anchorSnapshotById.set(anchorSessionId, {
    digest,
    snapshot: records.length > 0 ? [...records] : EMPTY_SNAPSHOT,
  });
}

export function subscribeSessionFeedbackLoopDispatches(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSessionFeedbackLoopDispatchesSnapshotForAnchor(
  anchorSessionId: string | null | undefined,
): readonly SessionFeedbackLoopDispatchRecord[] {
  const key = anchorSessionId?.trim() ?? "";
  if (!key) return EMPTY_SNAPSHOT;
  publishAnchorSnapshot(key);
  return anchorSnapshotById.get(key)?.snapshot ?? EMPTY_SNAPSHOT;
}

export function registerSessionFeedbackLoopDispatch(
  record: Omit<SessionFeedbackLoopDispatchRecord, "status" | "createdAt"> & {
    status?: FeedbackLoopDispatchStatus;
    createdAt?: number;
  },
): SessionFeedbackLoopDispatchRecord {
  const anchorSessionId = record.anchorSessionId.trim();
  const full: SessionFeedbackLoopDispatchRecord = {
    ...record,
    status: record.status ?? "running",
    createdAt: record.createdAt ?? Date.now(),
  };
  const prev = recordsByAnchor.get(anchorSessionId) ?? [];
  const next = [full, ...prev.filter((r) => r.dispatchId !== full.dispatchId)].slice(
    0,
    MAX_RECORDS_PER_ANCHOR,
  );
  recordsByAnchor.set(anchorSessionId, next);
  publishAnchorSnapshot(anchorSessionId);
  notify();
  return full;
}

export function updateSessionFeedbackLoopDispatchStatus(input: {
  dispatchId: string;
  anchorSessionId: string;
  status: FeedbackLoopDispatchStatus;
  completedAt?: number;
}): void {
  const anchorSessionId = input.anchorSessionId.trim();
  const prev = recordsByAnchor.get(anchorSessionId);
  if (!prev) return;
  const next = prev.map((record) =>
    record.dispatchId === input.dispatchId
      ? {
          ...record,
          status: input.status,
          completedAt: input.completedAt ?? Date.now(),
        }
      : record,
  );
  recordsByAnchor.set(anchorSessionId, next);
  publishAnchorSnapshot(anchorSessionId);
  notify();
}

export function findRunningFeedbackLoopDispatchesForWorker(
  workerSessionId: string,
): SessionFeedbackLoopDispatchRecord[] {
  const id = workerSessionId.trim();
  if (!id) return [];
  const hits: SessionFeedbackLoopDispatchRecord[] = [];
  for (const records of recordsByAnchor.values()) {
    for (const record of records) {
      if (record.workerSessionId === id && record.status === "running") {
        hits.push(record);
      }
    }
  }
  return hits;
}
