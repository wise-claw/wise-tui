import { listen } from "@tauri-apps/api/event";
import {
  clearClaudeLlmProxyRecords,
  getClaudeLlmProxyConfig,
  listClaudeLlmProxyRecords,
  setClaudeLlmProxyConfig,
  subscribeClaudeLlmProxyRecords,
  type ClaudeLlmProxyRecord,
  type ClaudeLlmProxyStatus,
} from "../services/claudeLlmProxy";
import { tryIngestStreamJsonLineForLlmProxy } from "../utils/streamJsonLlmProxyIngest";

const MAX_RECORDS = 200;

type Listener = () => void;

type StoreSnapshot = {
  records: ClaudeLlmProxyRecord[];
  status: ClaudeLlmProxyStatus | null;
};

let records: ClaudeLlmProxyRecord[] = [];
let status: ClaudeLlmProxyStatus | null = null;
/** 稳定引用；仅在数据变更时替换，供 useSyncExternalStore 做 Object.is 比较 */
let snapshot: StoreSnapshot = { records, status };

let initialized = false;
let initPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function statusFieldsEqual(
  a: ClaudeLlmProxyStatus | null,
  b: ClaudeLlmProxyStatus | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.listening === b.listening &&
    a.running === b.running &&
    a.port === b.port &&
    a.upstream === b.upstream &&
    a.recordCount === b.recordCount &&
    a.localProxyUrl === b.localProxyUrl &&
    a.suggestedUpstream === b.suggestedUpstream
  );
}

function publish(): void {
  snapshot = { records, status };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function upsertRecord(record: ClaudeLlmProxyRecord) {
  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    records = [...records.slice(0, idx), record, ...records.slice(idx + 1)];
  } else {
    records = [record, ...records].slice(0, MAX_RECORDS);
  }
  if (status) {
    status = { ...status, recordCount: records.length };
  }
  publish();
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const [loaded, st] = await Promise.all([
        listClaudeLlmProxyRecords(),
        getClaudeLlmProxyConfig(),
      ]);
      records = loaded.slice(0, MAX_RECORDS);
      status = st;
      await subscribeClaudeLlmProxyRecords(upsertRecord);
      await listen<string>("claude-output", (ev) => {
        const line = typeof ev.payload === "string" ? ev.payload : String(ev.payload ?? "");
        const rec = tryIngestStreamJsonLineForLlmProxy(line);
        if (rec) upsertRecord(rec);
      });
      initialized = true;
      publish();
    } catch {
      /* 非 Tauri 环境 */
    }
  })();
  return initPromise;
}

export function subscribeClaudeLlmProxyStore(listener: Listener): () => void {
  void ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClaudeLlmProxyStoreSnapshot(): StoreSnapshot {
  return snapshot;
}

export async function refreshClaudeLlmProxyStatus(projectPath?: string | null): Promise<void> {
  try {
    const next = await getClaudeLlmProxyConfig(projectPath);
    if (statusFieldsEqual(status, next)) return;
    status = next;
    publish();
  } catch {
    /* ignore */
  }
}

export async function applyClaudeLlmProxyConfig(
  listening: boolean,
  upstream: string,
  projectPath?: string | null,
): Promise<void> {
  const next = await setClaudeLlmProxyConfig({
    listening,
    upstream,
    projectPath,
  });
  status = next;
  if (!listening) {
    records = [];
  }
  publish();
}

export async function clearClaudeLlmProxyStore(): Promise<void> {
  await clearClaudeLlmProxyRecords();
  records = [];
  if (status) status = { ...status, recordCount: 0 };
  publish();
}
