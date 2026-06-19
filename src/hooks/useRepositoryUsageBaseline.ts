import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  getClaudeCodeUsageSnapshot,
  type ClaudeUsageSnapshotResponse,
} from "../services/claudeCodeUsage";
import {
  computeRepositoryUsageBaseline,
  type SessionRepositoryUsageBaseline,
} from "../utils/sessionUsageBaseline";

export function useRepositoryUsageBaseline(
  repositoryPath?: string | null,
): SessionRepositoryUsageBaseline | null {
  const [baseline, setBaseline] = useState<SessionRepositoryUsageBaseline | null>(null);

  useEffect(() => {
    const path = repositoryPath?.trim() ?? "";
    if (!path || !isTauri()) {
      setBaseline(null);
      return;
    }

    let cancelled = false;
    void getClaudeCodeUsageSnapshot({ projectPath: path })
      .then((snap: ClaudeUsageSnapshotResponse | null) => {
        if (cancelled) return;
        setBaseline(snap ? computeRepositoryUsageBaseline(snap.day) : null);
      })
      .catch(() => {
        if (!cancelled) setBaseline(null);
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryPath]);

  return baseline;
}
