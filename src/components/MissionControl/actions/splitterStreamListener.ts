import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../../utils/safeTauriUnlisten";
import type { ClusterRunProgress } from "../presenter/types";

interface SplitterOutputEvent {
  clusterId: string;
  line: string;
  timestampMs: number;
}

interface SplitterProgressEvent {
  clusterId: string;
  kind: string;
  message: string;
  progressPercent: number;
  exitCode?: number | null;
  stdoutPath?: string | null;
  stderrPath?: string | null;
}

export interface ClusterProgressMap {
  [clusterId: string]: ClusterRunProgress;
}

export interface ClusterStdoutMap {
  [clusterId: string]: string[];
}

const MAX_LINES = 500;

export function useSplitterStream(): { progress: ClusterProgressMap; stdout: ClusterStdoutMap } {
  const [progress, setProgress] = useState<ClusterProgressMap>({});
  const [stdout, setStdout] = useState<ClusterStdoutMap>({});
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Map<string, Partial<ClusterRunProgress>>>(new Map());
  const startedRef = useRef<Map<string, number>>(new Map());
  const linesRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const flush = () => {
      const pending = pendingRef.current;
      if (pending.size === 0) return;
      setProgress((prev) => {
        const next = { ...prev };
        for (const [id, patch] of pending) {
          next[id] = { ...(next[id] ?? emptyProgress()), ...patch } as ClusterRunProgress;
        }
        return next;
      });
      pending.clear();
      frameRef.current = null;
    };

    const scheduleFlush = () => {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(flush);
    };

    const applyProgress = (clusterId: string, patch: Partial<ClusterRunProgress>) => {
      const existing = pendingRef.current.get(clusterId) ?? {};
      pendingRef.current.set(clusterId, { ...existing, ...patch });
      scheduleFlush();
    };

    const appendLine = (clusterId: string, line: string) => {
      const lines = linesRef.current.get(clusterId) ?? [];
      lines.push(line);
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      linesRef.current.set(clusterId, lines);
      // Throttle stdout state updates to ~15fps
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          setStdout(Object.fromEntries(linesRef.current));
          frameRef.current = null;
        });
      }
    };

    const resetClusterOutput = (clusterId: string) => {
      startedRef.current.delete(clusterId);
      linesRef.current.set(clusterId, []);
      setStdout((prev) => ({ ...prev, [clusterId]: [] }));
    };

    listen<SplitterOutputEvent>("splitter-output", (event) => {
      const { clusterId, line, timestampMs } = event.payload;
      if (!startedRef.current.has(clusterId)) {
        startedRef.current.set(clusterId, timestampMs);
      }
      const elapsed = timestampMs - (startedRef.current.get(clusterId) ?? timestampMs);
      appendLine(clusterId, line);
      applyProgress(clusterId, {
        status: "running",
        stageLabel: "生成任务中…",
        elapsedMs: elapsed,
      });
    }).then((fn) => unlisteners.push(fn));

    listen<SplitterProgressEvent>("splitter-progress", (event) => {
      const { clusterId, kind, message, progressPercent, exitCode, stdoutPath, stderrPath } = event.payload;
      if (kind === "started") {
        resetClusterOutput(clusterId);
      }
      const status =
        kind === "completed" ? "succeeded"
        : kind === "cancelled" ? "cancelled"
        : kind === "error" ? "failed"
        : "running";
      applyProgress(clusterId, {
        status,
        progressPercent,
        stageLabel: message,
        error: status === "failed" || status === "cancelled"
          ? {
            summary: message || "拆分失败",
            exitCode: typeof exitCode === "number" ? exitCode : null,
            stdoutPath: stdoutPath ?? "",
            stderrPath: stderrPath ?? "",
          }
          : null,
      });
    }).then((fn) => unlisteners.push(fn));

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      for (const fn of unlisteners) safeUnlisten(fn);
    };
  }, []);

  return { progress, stdout };
}

function emptyProgress(): ClusterRunProgress {
  return {
    status: "queued",
    progressPercent: 0,
    stageLabel: "等待中",
    elapsedMs: 0,
    error: null,
  };
}
