import { useEffect, useState } from "react";
import { listRecentMissions } from "../../services/missionControlBackend";
import type { MissionSnapshotRecord } from "../../services/missionControlBackend";

interface UseMissionLedgerOptions {
  projectId?: string | null;
  /** 轮询间隔 ms，默认 10000 */
  pollIntervalMs?: number;
}

export function useMissionLedger(options: UseMissionLedgerOptions = {}) {
  const { projectId, pollIntervalMs = 10_000 } = options;

  const [activeMission, setActiveMission] = useState<MissionSnapshotRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setActiveMission(null);
      return;
    }

    let cancelled = false;

    const fetch = () => {
      if (cancelled) return;
      setLoading(true);
      listRecentMissions({ projectId, limit: 1 })
        .then((missions) => {
          if (!cancelled) {
            setActiveMission(missions.length > 0 ? missions[0] : null);
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
  }, [projectId, pollIntervalMs]);

  return { activeMission, loading };
}
