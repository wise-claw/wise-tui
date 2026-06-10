import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  clearClaudeLlmProxyRecords,
  getClaudeLlmProxyConfig,
  listClaudeLlmProxyRecords,
  setClaudeLlmProxyConfig,
  subscribeClaudeLlmProxyRecords,
  type ClaudeLlmProxyRecord,
  type ClaudeLlmProxyStatus,
} from "../services/claudeLlmProxy";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { WISE_CLAUDE_USER_SETTINGS_CHANGED } from "../services/claudeModelProfiles";
import { tryIngestStreamJsonLineForLlmProxy } from "../utils/streamJsonLlmProxyIngest";

const MAX_RECORDS = 80;

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
let recordsUnlisten: UnlistenFn | null = null;
let claudeOutputUnlisten: UnlistenFn | null = null;
let claudeOutputIngestPromise: Promise<void> | null = null;
let settingsChangedHandler: ((e: Event) => void) | null = null;
const listeners = new Set<Listener>();
let stdoutIngestConsumers = 0;

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

function handleClaudeOutputLine(line: string): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  // HTTP 代理已在监听时由 Rust 侧抓包；stdout 兜底会与 /v1/messages 重复。
  if (status?.listening && status?.running) return;
  const rec = tryIngestStreamJsonLineForLlmProxy(line);
  if (rec) upsertRecord(rec);
}

async function ensureClaudeOutputIngestAttached(): Promise<void> {
  if (claudeOutputUnlisten) return;
  if (claudeOutputIngestPromise) return claudeOutputIngestPromise;
  claudeOutputIngestPromise = (async () => {
    try {
      const next = await listen<string>("claude-output", (ev) => {
        const line = typeof ev.payload === "string" ? ev.payload : String(ev.payload ?? "");
        handleClaudeOutputLine(line);
      });
      if (stdoutIngestConsumers <= 0) {
        safeUnlisten(next);
        return;
      }
      claudeOutputUnlisten = next;
    } catch {
      /* 非 Tauri 环境 */
    } finally {
      claudeOutputIngestPromise = null;
    }
  })();
  return claudeOutputIngestPromise;
}

function detachClaudeOutputIngest(): void {
  safeUnlisten(claudeOutputUnlisten);
  claudeOutputUnlisten = null;
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
      const nextRecordsUnlisten = await subscribeClaudeLlmProxyRecords(upsertRecord);
      if (listeners.size === 0 && stdoutIngestConsumers <= 0) {
        safeUnlisten(nextRecordsUnlisten);
        initPromise = null;
        return;
      }
      recordsUnlisten = nextRecordsUnlisten;
      if (stdoutIngestConsumers > 0) {
        await ensureClaudeOutputIngestAttached();
      }
      settingsChangedHandler = (e: Event) => {
        const detail = (e as CustomEvent<{ optimistic?: boolean }>).detail;
        if (detail?.optimistic) return;
        void refreshClaudeLlmProxyStatus();
      };
      window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, settingsChangedHandler);
      initialized = true;
      publish();
    } catch {
      /* 非 Tauri 环境 */
    }
  })();
  return initPromise;
}

function teardownRuntimeIfIdle(): void {
  if (listeners.size > 0 || stdoutIngestConsumers > 0) return;
  safeUnlisten(recordsUnlisten);
  detachClaudeOutputIngest();
  recordsUnlisten = null;
  if (settingsChangedHandler) {
    window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, settingsChangedHandler);
    settingsChangedHandler = null;
  }
  initialized = false;
  initPromise = null;
  records = [];
  status = null;
  snapshot = { records, status };
}

/** 仅在 LLM 代理面板打开时需要 stdout 兜底抓包；避免顶栏徽章订阅拖慢全局 claude-output。 */
export function retainClaudeLlmProxyStdoutIngest(): () => void {
  stdoutIngestConsumers += 1;
  void ensureInitialized().then(() => {
    if (stdoutIngestConsumers > 0) {
      void ensureClaudeOutputIngestAttached();
    }
  });
  return () => {
    stdoutIngestConsumers = Math.max(0, stdoutIngestConsumers - 1);
    if (stdoutIngestConsumers <= 0) {
      detachClaudeOutputIngest();
      teardownRuntimeIfIdle();
    }
  };
}

export function subscribeClaudeLlmProxyStore(listener: Listener): () => void {
  void ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    teardownRuntimeIfIdle();
  };
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
