import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../../utils/safeTauriUnlisten";
import {
  listActivePrdRuns,
  type ActivePrdRunRow,
} from "../../../services/prdSplit/activeRuns";

interface SplitterCompleteEvent {
  clusterId: string;
  status: "succeeded" | "failed" | "cancelled";
  runId?: string;
  runDir: string;
  durationMs: number;
}

export interface BackgroundRunState {
  runId: string;
  clusterId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  runDir: string;
  startedAtMs: number;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  hasRunResult: boolean;
  projectRootPath: string;
  missionId: string | null;
  parentTaskPath: string | null;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  error: string | null;
}

export type { ActivePrdRunRow };

export function useMissionRunStore() {
  const [backgroundRuns, setBackgroundRuns] = useState<Record<string, BackgroundRunState>>({});

  const refreshBackgroundRuns = useCallback(async () => {
    const rows = await listActivePrdRuns();
    setBackgroundRuns(reduceBackgroundRuns(rows));
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshBackgroundRuns().catch(() => {
      if (cancelled) return;
      // Non-critical: Mission Control can still receive live events after mount.
    });
    return () => { cancelled = true; };
  }, [refreshBackgroundRuns]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    void listen<SplitterCompleteEvent>("splitter-complete", (event) => {
      const { clusterId, runId, status } = event.payload;
      setBackgroundRuns((prev) => {
        const next = { ...prev };
        for (const [id, run] of Object.entries(next)) {
          if ((runId && run.runId === runId) || (!runId && run.clusterId === clusterId)) {
            next[id] = {
              ...run,
              status,
              hasRunResult: true,
              error:
                status === "failed"
                  ? run.error ?? "Splitter run failed"
                  : status === "cancelled"
                    ? run.error ?? "Splitter run cancelled"
                    : null,
            };
          }
        }
        return next;
      });
    }).then((fn) => {
      if (cancelled) {
        safeUnlisten(fn);
        return;
      }
      unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      for (const fn of unlisteners) safeUnlisten(fn);
    };
  }, []);

  return { backgroundRuns, refreshBackgroundRuns };
}

export function reduceBackgroundRuns(rows: ActivePrdRunRow[]): Record<string, BackgroundRunState> {
  const runs: Record<string, BackgroundRunState> = {};
  for (const row of rows) {
    if (!row.runId || !row.clusterId) continue;
    runs[row.runId] = {
      runId: row.runId,
      clusterId: row.clusterId,
      status: normalizeStatus(row.status),
      runDir: row.runDir,
      startedAtMs: row.startedAtMs,
      exitCode: typeof row.exitCode === "number" ? row.exitCode : null,
      stdoutTail: row.stdoutTail ?? "",
      stderrTail: row.stderrTail ?? "",
      hasRunResult: Boolean(row.hasRunResult),
      projectRootPath: row.projectRootPath ?? "",
      missionId: row.missionId ?? null,
      parentTaskPath: row.parentTaskPath ?? null,
      stdoutPath: row.stdoutPath ?? "",
      stderrPath: row.stderrPath ?? "",
      rawResultPath: row.rawResultPath ?? "",
      error: row.error ?? null,
    };
  }
  return runs;
}

function normalizeStatus(status: ActivePrdRunRow["status"] | string): BackgroundRunState["status"] {
  return status === "succeeded" || status === "failed" || status === "cancelled" ? status : "running";
}
