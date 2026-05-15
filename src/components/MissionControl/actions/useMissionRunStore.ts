import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface SplitterCompleteEvent {
  clusterId: string;
  status: "succeeded" | "failed";
  runDir: string;
  durationMs: number;
}

export interface BackgroundRunState {
  runId: string;
  clusterId: string;
  status: "running" | "succeeded" | "failed";
  runDir: string;
  startedAt: number;
}

export function useMissionRunStore() {
  const [backgroundRuns, setBackgroundRuns] = useState<Record<string, BackgroundRunState>>({});

  // On mount, scan ~/.wise/prd-runs/ for incomplete runs via the existing list command.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<{ runs: Array<{ run_id: string; run_dir: string; created_at_ms: number; has_split_result: boolean }> }>(
          "prd_split_list_legacy_runs",
        );
        const runs: Record<string, BackgroundRunState> = {};
        for (const run of result.runs) {
          if (!run.has_split_result) {
            runs[run.run_id] = {
              runId: run.run_id,
              clusterId: run.run_id,
              status: "running",
              runDir: run.run_dir,
              startedAt: run.created_at_ms,
            };
          }
        }
        if (!cancelled) setBackgroundRuns(runs);
      } catch {
        // Non-critical — run scanning is best-effort.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listen for completion events from background tasks.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    listen<SplitterCompleteEvent>("splitter-complete", (event) => {
      const { clusterId, status } = event.payload;
      setBackgroundRuns((prev) => {
        const next = { ...prev };
        for (const [id, run] of Object.entries(next)) {
          if (run.clusterId === clusterId) {
            next[id] = { ...run, status };
          }
        }
        return next;
      });
    }).then((fn) => unlisteners.push(fn));

    return () => {
      for (const fn of unlisteners) fn();
    };
  }, []);

  return { backgroundRuns };
}
