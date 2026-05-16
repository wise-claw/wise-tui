import { useEffect, useState } from "react";
import {
  listMissionAgentAssignments,
  type MissionAgentAssignment,
} from "../services/missionControlBackend";

interface UseAgentAssignmentsOptions {
  /** 按项目过滤 */
  projectId?: string | null;
  /** 按 Mission 过滤 */
  missionId?: string | null;
  /** 是否包含已完成的指派，默认 false */
  includeCompleted?: boolean;
  /** 轮询间隔 ms，默认 5000 */
  pollIntervalMs?: number;
  /** 是否启用轮询，默认 true */
  enabled?: boolean;
}

export function useAgentAssignments(options: UseAgentAssignmentsOptions = {}) {
  const {
    projectId,
    missionId,
    includeCompleted = false,
    pollIntervalMs = 5_000,
    enabled = true,
  } = options;

  const [assignments, setAssignments] = useState<MissionAgentAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAssignments([]);
      return;
    }

    let cancelled = false;

    const fetch = () => {
      if (cancelled) return;
      setLoading(true);
      listMissionAgentAssignments({
        missionId: missionId ?? null,
        projectId: projectId ?? null,
        includeCompleted: includeCompleted ? true : null,
      })
        .then((list) => {
          if (!cancelled) {
            setAssignments(list);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetch();
    const timer = setInterval(fetch, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, missionId, includeCompleted, pollIntervalMs, enabled]);

  const running = assignments.filter((a) => a.status === "running" || a.status === "stale");
  const queued = assignments.filter((a) => a.status === "queued");
  const completed = assignments.filter(
    (a) => a.status === "completed" || a.status === "succeeded",
  );

  return { assignments, running, queued, completed, loading };
}
