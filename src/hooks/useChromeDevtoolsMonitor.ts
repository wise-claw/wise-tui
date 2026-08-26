import { message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_PAGE_MONITOR_DEBUG_PORT,
  DEFAULT_PAGE_MONITOR_SYNTHETIC_INTERVAL_SECS,
  DEFAULT_PAGE_MONITOR_VITALS_THRESHOLDS,
  normalizePageMonitorChromeMode,
  normalizePageMonitorDebugPort,
  normalizePageMonitorSyntheticIntervalSecs,
  normalizePageMonitorVitalsThresholds,
  downloadChromePageMonitorExtension,
  type PageMonitorChromeMode,
  type PageMonitorVitalsThresholds,
} from "../services/chromeDevtoolsMonitor";
import {
  getPageMonitorRuntimeSnapshot,
  startPageMonitor,
  stopPageMonitor,
  subscribePageMonitorRuntimeForSession,
  syncPageMonitorFormState,
  togglePageMonitor,
  type PageMonitorRuntimeState,
} from "../stores/chromeDevtoolsMonitorRuntimeStore";
import {
  normalizeRunOpenUrl,
  repositoryRunCommandStorageKeys,
} from "../utils/repositoryRunCommand";

function pageMonitorAutoFixStorageKey(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return `wise.topbar.page-monitor-auto-fix:${trimmed}`;
}

function pageMonitorModeStorageKey(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return `wise.topbar.page-monitor-mode:${trimmed}`;
}

function pageMonitorDebugPortStorageKey(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return `wise.topbar.page-monitor-debug-port:${trimmed}`;
}

function pageMonitorVitalsStorageKey(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return `wise.topbar.page-monitor-vitals:${trimmed}`;
}

function pageMonitorSyntheticStorageKey(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return `wise.topbar.page-monitor-synthetic-secs:${trimmed}`;
}

function readAutoFixEnabled(storageKey: string | null): boolean {
  if (!storageKey) return true;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return true;
  return raw === "1" || raw === "true";
}

function readPreferredUrl(cwd: string): string {
  const { runUrlKey } = repositoryRunCommandStorageKeys(cwd);
  if (!runUrlKey) return "";
  return window.localStorage.getItem(runUrlKey) ?? "";
}

function readChromeMode(storageKey: string | null): PageMonitorChromeMode {
  if (!storageKey) return "launch";
  return normalizePageMonitorChromeMode(window.localStorage.getItem(storageKey));
}

function readDebugPort(storageKey: string | null): number {
  if (!storageKey) return DEFAULT_PAGE_MONITOR_DEBUG_PORT;
  return normalizePageMonitorDebugPort(window.localStorage.getItem(storageKey));
}

function readVitals(storageKey: string | null): PageMonitorVitalsThresholds {
  if (!storageKey) return DEFAULT_PAGE_MONITOR_VITALS_THRESHOLDS;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return DEFAULT_PAGE_MONITOR_VITALS_THRESHOLDS;
  try {
    return normalizePageMonitorVitalsThresholds(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PAGE_MONITOR_VITALS_THRESHOLDS;
  }
}

function readSyntheticSecs(storageKey: string | null): number {
  if (!storageKey) return DEFAULT_PAGE_MONITOR_SYNTHETIC_INTERVAL_SECS;
  return normalizePageMonitorSyntheticIntervalSecs(window.localStorage.getItem(storageKey));
}

const IDLE_SNAPSHOT: PageMonitorRuntimeState = {
  status: "idle",
  statusHint: "未监控",
  url: "",
  autoFixEnabled: true,
  issuePreview: [],
  timeline: [],
};

export function useChromeDevtoolsMonitor(input: {
  repositoryId: number | null | undefined;
  repositoryPath: string;
}) {
  const sessionId =
    input.repositoryId != null && Number.isFinite(input.repositoryId)
      ? String(input.repositoryId)
      : "";
  const trimmedPath = input.repositoryPath.trim();
  const autoFixKey = pageMonitorAutoFixStorageKey(trimmedPath);
  const modeKey = pageMonitorModeStorageKey(trimmedPath);
  const debugPortKey = pageMonitorDebugPortStorageKey(trimmedPath);
  const vitalsKey = pageMonitorVitalsStorageKey(trimmedPath);
  const syntheticKey = pageMonitorSyntheticStorageKey(trimmedPath);

  const [urlDraft, setUrlDraft] = useState(() => readPreferredUrl(trimmedPath));
  const [autoFixEnabled, setAutoFixEnabledState] = useState(() => readAutoFixEnabled(autoFixKey));
  const [chromeMode, setChromeModeState] = useState<PageMonitorChromeMode>(() =>
    readChromeMode(modeKey),
  );
  const [debugPortDraft, setDebugPortDraft] = useState(() => String(readDebugPort(debugPortKey)));
  const [vitalsDraft, setVitalsDraft] = useState(() => readVitals(vitalsKey));
  const [syntheticEnabled, setSyntheticEnabledState] = useState(
    () => readSyntheticSecs(syntheticKey) > 0,
  );

  useEffect(() => {
    setUrlDraft(readPreferredUrl(trimmedPath));
    setAutoFixEnabledState(readAutoFixEnabled(autoFixKey));
    setChromeModeState(readChromeMode(modeKey));
    setDebugPortDraft(String(readDebugPort(debugPortKey)));
    setVitalsDraft(readVitals(vitalsKey));
    setSyntheticEnabledState(readSyntheticSecs(syntheticKey) > 0);
  }, [autoFixKey, debugPortKey, modeKey, syntheticKey, trimmedPath, vitalsKey]);

  const runtime = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!sessionId) return () => undefined;
        return subscribePageMonitorRuntimeForSession(sessionId, listener);
      },
      [sessionId],
    ),
    useCallback(
      () => (sessionId ? getPageMonitorRuntimeSnapshot(sessionId) : IDLE_SNAPSHOT),
      [sessionId],
    ),
    () => IDLE_SNAPSHOT,
  );

  useEffect(() => {
    if (!sessionId) return;
    syncPageMonitorFormState(sessionId, { url: urlDraft, autoFixEnabled });
  }, [autoFixEnabled, sessionId, urlDraft]);

  const setAutoFixEnabled = useCallback(
    (enabled: boolean) => {
      setAutoFixEnabledState(enabled);
      if (autoFixKey) {
        window.localStorage.setItem(autoFixKey, enabled ? "1" : "0");
      }
    },
    [autoFixKey],
  );

  const setChromeMode = useCallback(
    (mode: PageMonitorChromeMode) => {
      const next = normalizePageMonitorChromeMode(mode);
      setChromeModeState(next);
      if (modeKey) {
        window.localStorage.setItem(modeKey, next);
      }
    },
    [modeKey],
  );

  const setDebugPortDraftSafe = useCallback((value: string) => {
    setDebugPortDraft(value.replace(/[^\d]/g, "").slice(0, 5));
  }, []);

  const saveUrl = useCallback(() => {
    const normalized = normalizeRunOpenUrl(urlDraft);
    if (!normalized) return false;
    setUrlDraft(normalized);
    const { runUrlKey } = repositoryRunCommandStorageKeys(trimmedPath);
    if (runUrlKey) {
      window.localStorage.setItem(runUrlKey, normalized);
    }
    return true;
  }, [trimmedPath, urlDraft]);

  const resolveUrl = useCallback((): string => {
    return normalizeRunOpenUrl(urlDraft) ?? normalizeRunOpenUrl(runtime.url) ?? "http://localhost:5173";
  }, [runtime.url, urlDraft]);

  const resolveDebugPort = useCallback((): number => {
    const port = normalizePageMonitorDebugPort(debugPortDraft);
    setDebugPortDraft(String(port));
    if (debugPortKey) {
      window.localStorage.setItem(debugPortKey, String(port));
    }
    return port;
  }, [debugPortDraft, debugPortKey]);

  const resolveVitals = useCallback((): PageMonitorVitalsThresholds => {
    const next = normalizePageMonitorVitalsThresholds(vitalsDraft);
    setVitalsDraft(next);
    if (vitalsKey) {
      window.localStorage.setItem(vitalsKey, JSON.stringify(next));
    }
    return next;
  }, [vitalsDraft, vitalsKey]);

  const setVitalsThresholds = useCallback((next: PageMonitorVitalsThresholds) => {
    setVitalsDraft(normalizePageMonitorVitalsThresholds(next));
  }, []);

  const setSyntheticEnabled = useCallback(
    (enabled: boolean) => {
      setSyntheticEnabledState(enabled);
      if (syntheticKey) {
        window.localStorage.setItem(
          syntheticKey,
          String(enabled ? DEFAULT_PAGE_MONITOR_SYNTHETIC_INTERVAL_SECS : 0),
        );
      }
    },
    [syntheticKey],
  );

  const resolveSyntheticSecs = useCallback((): number => {
    const secs = syntheticEnabled ? DEFAULT_PAGE_MONITOR_SYNTHETIC_INTERVAL_SECS : 0;
    if (syntheticKey) {
      window.localStorage.setItem(syntheticKey, String(secs));
    }
    return secs;
  }, [syntheticEnabled, syntheticKey]);

  const start = useCallback(async () => {
    if (!sessionId) return;
    const url = resolveUrl();
    setUrlDraft(url);
    const debugPort = resolveDebugPort();
    const vitals = resolveVitals();
    const syntheticIntervalSecs = resolveSyntheticSecs();
    await startPageMonitor({
      sessionId,
      url,
      autoFixEnabled,
      mode: chromeMode,
      debugPort,
      vitals,
      syntheticIntervalSecs,
    });
  }, [
    autoFixEnabled,
    chromeMode,
    resolveDebugPort,
    resolveSyntheticSecs,
    resolveUrl,
    resolveVitals,
    sessionId,
  ]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    await stopPageMonitor(sessionId);
  }, [sessionId]);

  const toggle = useCallback(async () => {
    if (!sessionId) return;
    await togglePageMonitor({
      sessionId,
      url: resolveUrl(),
      autoFixEnabled,
      mode: chromeMode,
      debugPort: resolveDebugPort(),
      vitals: resolveVitals(),
      syntheticIntervalSecs: resolveSyntheticSecs(),
    });
  }, [
    autoFixEnabled,
    chromeMode,
    resolveDebugPort,
    resolveSyntheticSecs,
    resolveUrl,
    resolveVitals,
    sessionId,
  ]);

  const downloadExtension = useCallback(async () => {
    try {
      const dest = await downloadChromePageMonitorExtension();
      message.success(`扩展已下载到：${dest}`);
    } catch (error) {
      const msgText = error instanceof Error ? error.message : String(error);
      message.error(`无法下载扩展：${msgText}`);
    }
  }, []);

  const isActive = useMemo(
    () =>
      runtime.status === "monitoring" ||
      runtime.status === "starting" ||
      runtime.status === "stopping",
    [runtime.status],
  );

  return {
    sessionId,
    urlDraft,
    setUrlDraft,
    autoFixEnabled,
    setAutoFixEnabled,
    chromeMode,
    setChromeMode,
    debugPortDraft,
    setDebugPortDraft: setDebugPortDraftSafe,
    vitalsThresholds: vitalsDraft,
    setVitalsThresholds,
    syntheticEnabled,
    setSyntheticEnabled,
    saveUrl,
    resolveUrl,
    status: runtime.status,
    statusHint: runtime.statusHint,
    issuePreview: runtime.issuePreview,
    timeline: runtime.timeline ?? [],
    isActive,
    start,
    stop,
    toggle,
    downloadExtension,
    /** @deprecated Prefer {@link downloadExtension}. */
    openExtensionDir: downloadExtension,
  };
}
