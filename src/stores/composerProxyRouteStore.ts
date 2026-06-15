import { getClaudeLlmProxyStatus, type ClaudeLlmProxyStatus } from "../services/claudeLlmProxy";
import { getFreeClaudeCodeStatus, type FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import {
  getOpencodeGoProxyStatus,
  type OpencodeGoProxyStatus,
} from "../services/opencodeGoProxy";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

const VISIBLE_POLL_MS = 5000;
const HIDDEN_POLL_MS = 15000;

type Listener = () => void;

export type ComposerProxyRouteStoreSnapshot = {
  opencodeGo: OpencodeGoProxyStatus | null;
  llmProxy: ClaudeLlmProxyStatus | null;
  fcc: FreeClaudeCodeStatus | null;
  loading: boolean;
};

let opencodeGo: OpencodeGoProxyStatus | null = null;
let llmProxy: ClaudeLlmProxyStatus | null = null;
let fcc: FreeClaudeCodeStatus | null = null;
let loading = true;
let snapshot: ComposerProxyRouteStoreSnapshot = {
  opencodeGo,
  llmProxy,
  fcc,
  loading,
};

let pollConsumers = 0;
let disposePoll: (() => void) | null = null;
let refreshInFlight = false;
const listeners = new Set<Listener>();

function publish(): void {
  snapshot = { opencodeGo, llmProxy, fcc, loading };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function proxyStatusesEqual(
  prev: ComposerProxyRouteStoreSnapshot,
  next: ComposerProxyRouteStoreSnapshot,
): boolean {
  const po = prev.opencodeGo;
  const no = next.opencodeGo;
  if (Boolean(po?.enabled && po?.running) !== Boolean(no?.enabled && no?.running)) return false;
  if (po?.claudeSettingsAligned !== no?.claudeSettingsAligned) return false;
  if (po?.codexSettingsAligned !== no?.codexSettingsAligned) return false;
  if (po?.defaultModel !== no?.defaultModel) return false;
  if (po?.proxyBaseUrl !== no?.proxyBaseUrl) return false;

  const pl = prev.llmProxy;
  const nl = next.llmProxy;
  if (Boolean(pl?.listening && pl?.running) !== Boolean(nl?.listening && nl?.running)) return false;
  if (pl?.upstream !== nl?.upstream) return false;
  if (pl?.localProxyUrl !== nl?.localProxyUrl) return false;

  const pf = prev.fcc;
  const nf = next.fcc;
  if (Boolean(pf?.serverRunning) !== Boolean(nf?.serverRunning)) return false;
  if (pf?.claudeSettingsAligned !== nf?.claudeSettingsAligned) return false;
  if (pf?.proxyBaseUrl !== nf?.proxyBaseUrl) return false;

  return prev.loading === next.loading;
}

async function refreshComposerProxyRouteStore(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const nextLoading = opencodeGo == null && llmProxy == null && fcc == null;
  if (nextLoading !== loading) {
    loading = nextLoading;
    publish();
  }
  try {
    const [nextOcgo, nextLlm, nextFcc] = await Promise.all([
      getOpencodeGoProxyStatus(),
      getClaudeLlmProxyStatus(),
      getFreeClaudeCodeStatus(),
    ]);
    const nextSnapshot: ComposerProxyRouteStoreSnapshot = {
      opencodeGo: nextOcgo,
      llmProxy: nextLlm,
      fcc: nextFcc,
      loading: false,
    };
    if (!proxyStatusesEqual(snapshot, nextSnapshot)) {
      opencodeGo = nextOcgo;
      llmProxy = nextLlm;
      fcc = nextFcc;
      loading = false;
      publish();
    } else if (loading) {
      loading = false;
      publish();
    }
  } catch {
    if (loading) {
      loading = false;
      publish();
    }
  } finally {
    refreshInFlight = false;
  }
}

export function subscribeComposerProxyRouteStore(listener: Listener): () => void {
  listeners.add(listener);
  pollConsumers += 1;
  if (!disposePoll) {
    void refreshComposerProxyRouteStore();
    disposePoll = startAdaptiveInterval(
      () => void refreshComposerProxyRouteStore(),
      VISIBLE_POLL_MS,
      HIDDEN_POLL_MS,
    );
  }
  return () => {
    listeners.delete(listener);
    pollConsumers = Math.max(0, pollConsumers - 1);
    if (pollConsumers === 0 && disposePoll) {
      disposePoll();
      disposePoll = null;
    }
  };
}

export function getComposerProxyRouteStoreSnapshot(): ComposerProxyRouteStoreSnapshot {
  return snapshot;
}

export async function refreshComposerProxyRouteStoreNow(): Promise<void> {
  await refreshComposerProxyRouteStore();
}
