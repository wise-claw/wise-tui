import { useCallback, useEffect, useRef } from "react";
import type { ClaudeHostProcess, ClaudeSession, ProjectItem, Repository } from "../types";
import { getAppSettingJson, setAppSettingJson } from "../services/appSettingsStore";
import {
  CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY,
  createClaudeProcessWorkspaceLabelCache,
  entryFromWorkspaceLabels,
  lookupClaudeProcessLabelCache,
  parseClaudeProcessLabelCachePayload,
  rememberClaudeProcessLabelCache,
  serializeClaudeProcessLabelCache,
  syncClaudeProcessLabelCacheFromRuntime,
  type ClaudeProcessLabelCacheEntry,
  type ClaudeProcessLabelCacheLookupKeys,
  type ClaudeProcessWorkspaceLabelCacheState,
} from "../utils/claudeProcessWorkspaceLabelCache";
import type { ClaudeProcessWorkspaceLabels } from "../utils/resolveClaudeProcessWorkspaceLabels";

export interface ClaudeProcessWorkspaceLabelCacheHandle {
  lookup: (keys: ClaudeProcessLabelCacheLookupKeys) => ClaudeProcessLabelCacheEntry | null;
  rememberResolved: (
    keys: ClaudeProcessLabelCacheLookupKeys,
    labels: ClaudeProcessWorkspaceLabels,
    repositoryPathKey: string | null,
  ) => void;
  syncFromRuntime: (params: {
    projects: ReadonlyArray<ProjectItem>;
    repositories: Repository[];
    bindings: Record<string, string>;
    sessions: ClaudeSession[];
    claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  }) => void;
}

export function useClaudeProcessWorkspaceLabelCache(): ClaudeProcessWorkspaceLabelCacheHandle {
  const stateRef = useRef<ClaudeProcessWorkspaceLabelCacheState>(
    createClaudeProcessWorkspaceLabelCache(),
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  const schedulePersist = useCallback(() => {
    if (!hydratedRef.current) {
      return;
    }
    if (persistTimerRef.current != null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void setAppSettingJson(
        CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY,
        serializeClaudeProcessLabelCache(stateRef.current),
      );
    }, 600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppSettingJson<unknown>(CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY).then((raw) => {
      if (cancelled) {
        return;
      }
      const stored = parseClaudeProcessLabelCachePayload(raw ?? {});
      stateRef.current = createClaudeProcessWorkspaceLabelCache(stored);
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
      if (persistTimerRef.current != null) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  const lookup = useCallback((keys: ClaudeProcessLabelCacheLookupKeys) => {
    return lookupClaudeProcessLabelCache(stateRef.current, keys);
  }, []);

  const rememberResolved = useCallback(
    (
      keys: ClaudeProcessLabelCacheLookupKeys,
      labels: ClaudeProcessWorkspaceLabels,
      repositoryPathKey: string | null,
    ) => {
      rememberClaudeProcessLabelCache(
        stateRef.current,
        keys,
        entryFromWorkspaceLabels(labels, repositoryPathKey),
      );
      schedulePersist();
    },
    [schedulePersist],
  );

  const syncFromRuntime = useCallback(
    (params: {
      projects: ReadonlyArray<ProjectItem>;
      repositories: Repository[];
      bindings: Record<string, string>;
      sessions: ClaudeSession[];
      claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
    }) => {
      const dirty = syncClaudeProcessLabelCacheFromRuntime(stateRef.current, params);
      if (dirty) {
        schedulePersist();
      }
    },
    [schedulePersist],
  );

  return { lookup, rememberResolved, syncFromRuntime };
}
