import { useEffect, useState } from "react";
import {
  getTrellisAgentOwnershipGraph,
  listTrellisRuntimeEvents,
  getTrellisOnboardingState,
  getTrellisReplay,
  type TrellisAgentOwnershipGraph,
  type TrellisRuntimeEvent,
  type TrellisOnboardingState,
  type TrellisReplayEntry,
} from "../services/trellisRuntime";

/** Shared hook: Trellis Runtime observability. Polls agent graph + events. */
export function useTrellisRuntime(options: {
  projectId?: string | null;
  rootPath?: string | null;
  sessionId?: string | null;
  taskPath?: string | null;
  pollIntervalMs?: number;
  enabled?: boolean;
} = {}) {
  const { projectId, rootPath, sessionId, taskPath, pollIntervalMs = 8_000, enabled = true } = options;

  const [agentGraph, setAgentGraph] = useState<TrellisAgentOwnershipGraph | null>(null);
  const [events, setEvents] = useState<TrellisRuntimeEvent[]>([]);
  const [onboarding, setOnboarding] = useState<TrellisOnboardingState | null>(null);
  const [replay, setReplay] = useState<TrellisReplayEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || (!projectId && !rootPath)) {
      setAgentGraph(null);
      setEvents([]);
      return;
    }

    let cancelled = false;

    const fetch = async () => {
      if (cancelled) return;
      setLoading(true);
      const [graph, evts] = await Promise.all([
        getTrellisAgentOwnershipGraph({ projectId, rootPath, sessionId, taskPath })
          .catch(() => null),
        listTrellisRuntimeEvents({ projectId, rootPath, sessionId, taskPath, limit: 50 })
          .catch(() => [] as TrellisRuntimeEvent[]),
      ]);
      if (!cancelled) {
        setAgentGraph(graph);
        setEvents(evts);
        setLoading(false);
      }
    };

    fetch();
    const timer = setInterval(fetch, pollIntervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projectId, rootPath, sessionId, taskPath, pollIntervalMs, enabled]);

  // Onboarding — fetch once on mount
  useEffect(() => {
    if (!rootPath) return;
    getTrellisOnboardingState({ projectId, rootPath }).then(setOnboarding).catch(() => {});
  }, [projectId, rootPath]);

  // Replay — fetch when tab changes
  const fetchReplay = (input: { sessionId?: string | null; taskPath?: string | null }) => {
    getTrellisReplay({ projectId, rootPath, ...input, limit: 100 })
      .then(setReplay)
      .catch(() => {});
  };

  return { agentGraph, events, onboarding, replay, fetchReplay, loading };
}
