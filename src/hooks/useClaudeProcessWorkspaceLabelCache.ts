import { useCallback, useEffect, useRef } from "react";
import type { ClaudeHostProcess, ClaudeSession, ProjectItem, Repository } from "../types";
import { getAppSettingJson, setAppSettingJson } from "../services/appSettingsStore";
import {
  CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY,
  createClaudeProcessWorkspaceLabelCache,
  entryFromWorkspaceLabels,
  lookupClaudeProcessLabelCache,
  mergeClaudeProcessLabelCacheStates,
  parseClaudeProcessLabelCachePayload,
  rememberClaudeProcessLabelCache,
  serializeClaudeProcessLabelCache,
  syncClaudeProcessLabelCacheFromRuntime,
  type ClaudeProcessLabelCacheEntry,
  type ClaudeProcessLabelCacheLookupKeys,
  type ClaudeProcessWorkspaceLabelCacheState,
} from "../utils/claudeProcessWorkspaceLabelCache";
import type { ClaudeProcessWorkspaceLabels } from "../utils/resolveClaudeProcessWorkspaceLabels";

const PERSIST_DEBOUNCE_MS = 600;

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
    sessions: readonly ClaudeSession[];
    claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  }) => void;
}

export function useClaudeProcessWorkspaceLabelCache(): ClaudeProcessWorkspaceLabelCacheHandle {
  const stateRef = useRef<ClaudeProcessWorkspaceLabelCacheState>(
    createClaudeProcessWorkspaceLabelCache(),
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  /** hydrate 完成前若已有 runtime 写入，落盘需与磁盘合并，不能整表覆盖。 */
  const dirtyBeforeHydrateRef = useRef(false);

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current != null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (!hydratedRef.current) return;
    void setAppSettingJson(
      CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY,
      serializeClaudeProcessLabelCache(stateRef.current),
    );
  }, []);

  const schedulePersist = useCallback(() => {
    if (!hydratedRef.current) {
      dirtyBeforeHydrateRef.current = true;
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
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppSettingJson<unknown>(CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY).then((raw) => {
      if (cancelled) return;
      const stored = parseClaudeProcessLabelCachePayload(raw ?? {});
      const disk = createClaudeProcessWorkspaceLabelCache(stored);
      if (dirtyBeforeHydrateRef.current) {
        stateRef.current = mergeClaudeProcessLabelCacheStates(stateRef.current, disk);
      } else {
        stateRef.current = disk;
      }
      hydratedRef.current = true;
      if (dirtyBeforeHydrateRef.current) {
        dirtyBeforeHydrateRef.current = false;
        schedulePersist();
      }
    });
    return () => {
      cancelled = true;
      // 卸载时 flush，避免 debounce 窗口内丢标签缓存。
      flushPersist();
    };
  }, [flushPersist, schedulePersist]);

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
      sessions: readonly ClaudeSession[];
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
