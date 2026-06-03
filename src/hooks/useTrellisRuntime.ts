import { useEffect, useState } from "react";
import {
  getTrellisAgentOwnershipGraph,
  listTrellisRuntimeEvents,
  getTrellisOnboardingState,
  getTrellisReplay,
  ingestExternalClaudeCliSessions,
  type TrellisAgentOwnershipGraph,
  type TrellisRuntimeEvent,
  type TrellisOnboardingState,
  type TrellisReplayEntry,
} from "../services/trellisRuntime";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";

const TRELLIS_RUNTIME_INGEST_TAIL_LINES = 1600;
const TRELLIS_RUNTIME_INGEST_TAIL_LINES_BACKGROUND = 400;
const TRELLIS_RUNTIME_EVENTS_IN_MEMORY_MAX = 50;

/** Shared hook: Trellis Runtime observability. Polls agent graph + events. */
export function useTrellisRuntime(options: {
  projectId?: string | null;
  rootPath?: string | null;
  sessionId?: string | null;
  missionId?: string | null;
  taskPath?: string | null;
  pollIntervalMs?: number;
  enabled?: boolean;
} = {}) {
  const { projectId, rootPath, sessionId, missionId, taskPath, pollIntervalMs = 8_000, enabled = true } = options;

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
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetch = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      setLoading(true);
      const fullIngest =
        typeof document === "undefined" || document.visibilityState === "visible";
      const ingested = fullIngest
        ? await ingestExternalClaudeCliSessions({
            projectId,
            rootPath: rootPath ?? "",
            missionId,
            sessionIds: sessionId ? [sessionId] : null,
            maxSessions: sessionId ? 1 : 12,
            tailLines: fullIngest
              ? TRELLIS_RUNTIME_INGEST_TAIL_LINES
              : TRELLIS_RUNTIME_INGEST_TAIL_LINES_BACKGROUND,
          }).catch(() => null)
        : null;
      if (cancelled) return;
      const effectiveRootPath = ingested?.rootPath ?? rootPath;
      const [graph, evts] = await Promise.all([
        getTrellisAgentOwnershipGraph({ projectId, rootPath: effectiveRootPath, sessionId, taskPath })
          .catch(() => null),
        listTrellisRuntimeEvents({ projectId, rootPath: effectiveRootPath, sessionId, taskPath, limit: TRELLIS_RUNTIME_EVENTS_IN_MEMORY_MAX })
          .catch(() => [] as TrellisRuntimeEvent[]),
      ]);
      if (!cancelled) {
        setAgentGraph(graph);
        setEvents(evts.slice(0, TRELLIS_RUNTIME_EVENTS_IN_MEMORY_MAX));
        setLoading(false);
      }
    };

    const scheduleTimer = () => {
      if (timer != null) clearInterval(timer);
      timer = setInterval(() => {
        void fetch();
      }, readVisiblePollIntervalMs(pollIntervalMs, pollIntervalMs * 4));
    };

    void fetch();
    scheduleTimer();
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        void fetch();
        scheduleTimer();
      } else {
        setAgentGraph(null);
        setEvents([]);
        setLoading(false);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      cancelled = true;
      if (timer != null) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [projectId, rootPath, sessionId, missionId, taskPath, pollIntervalMs, enabled]);

  // Onboarding — fetch once on mount
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    void getTrellisOnboardingState({ projectId, rootPath })
      .then((state) => {
        if (!cancelled) setOnboarding(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, rootPath]);

  // Replay — fetch when tab changes
  const fetchReplay = (input: { sessionId?: string | null; taskPath?: string | null }) => {
    getTrellisReplay({ projectId, rootPath, ...input, limit: 100 })
      .then(setReplay)
      .catch(() => {});
  };

  return { agentGraph, events, onboarding, replay, fetchReplay, loading };
}
