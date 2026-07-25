import { message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_PAGE_MONITOR_DEBUG_PORT,
  normalizePageMonitorChromeMode,
  normalizePageMonitorDebugPort,
  openChromePageMonitorExtensionDir,
  type PageMonitorChromeMode,
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

const IDLE_SNAPSHOT: PageMonitorRuntimeState = {
  status: "idle",
  statusHint: "未监控",
  url: "",
  autoFixEnabled: true,
  issuePreview: [],
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

  const [urlDraft, setUrlDraft] = useState(() => readPreferredUrl(trimmedPath));
  const [autoFixEnabled, setAutoFixEnabledState] = useState(() => readAutoFixEnabled(autoFixKey));
  const [chromeMode, setChromeModeState] = useState<PageMonitorChromeMode>(() =>
    readChromeMode(modeKey),
  );
  const [debugPortDraft, setDebugPortDraft] = useState(() => String(readDebugPort(debugPortKey)));

  useEffect(() => {
    setUrlDraft(readPreferredUrl(trimmedPath));
    setAutoFixEnabledState(readAutoFixEnabled(autoFixKey));
    setChromeModeState(readChromeMode(modeKey));
    setDebugPortDraft(String(readDebugPort(debugPortKey)));
  }, [autoFixKey, debugPortKey, modeKey, trimmedPath]);

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

  const start = useCallback(async () => {
    if (!sessionId) return;
    const url = resolveUrl();
    setUrlDraft(url);
    const debugPort = resolveDebugPort();
    await startPageMonitor({
      sessionId,
      url,
      autoFixEnabled,
      mode: chromeMode,
      debugPort,
    });
  }, [autoFixEnabled, chromeMode, resolveDebugPort, resolveUrl, sessionId]);

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
    });
  }, [autoFixEnabled, chromeMode, resolveDebugPort, resolveUrl, sessionId]);

  const openExtensionDir = useCallback(async () => {
    try {
      await openChromePageMonitorExtensionDir();
    } catch (error) {
      const msgText = error instanceof Error ? error.message : String(error);
      message.error(`无法打开扩展目录：${msgText}`);
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
    saveUrl,
    resolveUrl,
    status: runtime.status,
    statusHint: runtime.statusHint,
    issuePreview: runtime.issuePreview,
    isActive,
    start,
    stop,
    toggle,
    openExtensionDir,
  };
}
