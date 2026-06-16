import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upsertFeedbackLoopHabitsPhrase } from "../services/sessionFeedbackLoopComposer";
import {
  archiveFeedbackLoopHistory,
  compareWithHistoryAverage,
  listFeedbackLoopHistory,
  type FeedbackLoopHistoryRecord,
} from "../services/sessionFeedbackLoopHistoryStore";
import {
  clearSessionFeedbackLoopState,
  loadSessionFeedbackLoopState,
  saveSessionFeedbackLoopState,
} from "../services/sessionFeedbackLoopStore";
import type { SessionInsightsResult } from "../utils/sessionInsights";
import type { SessionInsightsReportMeta } from "../utils/sessionInsightsReport";
import {
  advanceFeedbackLoop,
  buildFeedbackLoopComparisonPrompt,
  buildFeedbackLoopHabitsPrompt,
  buildFeedbackLoopMarkdownReport,
  createInitialFeedbackLoopState,
  extractFeedbackLoopHabits,
  normalizeFeedbackLoopMaxCycles,
  startFeedbackLoop,
  stopFeedbackLoop,
  summarizeFeedbackLoopOutcome,
  type SessionFeedbackLoopState,
} from "../utils/sessionFeedbackLoop";

export interface UseSessionFeedbackLoopInput {
  sessionId: string;
  enabled: boolean;
  maxCycles?: number;
  autoStart?: boolean;
  earlyStopConvergence?: boolean;
    autoSaveHabitsToComposer?: boolean;
  repositoryPath?: string | null;
  insights: SessionInsightsResult | null;
  meta?: SessionInsightsReportMeta;
  onSendOptimizationPrompt?: (prompt: string) => void | Promise<void>;
  onCycleComplete?: (state: SessionFeedbackLoopState) => void;
}

export interface UseSessionFeedbackLoopResult {
  state: SessionFeedbackLoopState;
  isActive: boolean;
  habits: string[];
  historyRecords: FeedbackLoopHistoryRecord[];
  historyComparison: { average: number | null; delta: number | null };
  start: () => void;
  stop: () => void;
  reset: () => void;
  forceCompare: () => void;
  saveHabitsToComposer: () => Promise<boolean>;
  requestFinalSummary: () => string | null;
  requestHabitsPrompt: () => string | null;
  exportMarkdownReport: () => string | null;
}

export function useSessionFeedbackLoop(input: UseSessionFeedbackLoopInput): UseSessionFeedbackLoopResult {
  const {
    sessionId,
    enabled,
    insights,
    meta,
    repositoryPath,
    onSendOptimizationPrompt,
    onCycleComplete,
    maxCycles: maxCyclesInput = 3,
    autoStart = false,
    earlyStopConvergence = true,
    autoSaveHabitsToComposer = false,
  } = input;

  const maxCycles = normalizeFeedbackLoopMaxCycles(maxCyclesInput);

  const [state, setState] = useState<SessionFeedbackLoopState>(() => {
    const restored = loadSessionFeedbackLoopState(sessionId);
    return restored ?? createInitialFeedbackLoopState(sessionId, maxCycles);
  });
  const [historyVersion, setHistoryVersion] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;

  const onSendRef = useRef(onSendOptimizationPrompt);
  onSendRef.current = onSendOptimizationPrompt;

  const onCompleteRef = useRef(onCycleComplete);
  onCompleteRef.current = onCycleComplete;

  const insightsRef = useRef(insights);
  insightsRef.current = insights;

  const metaRef = useRef(meta);
  metaRef.current = meta;

  const repoPathRef = useRef(repositoryPath);
  repoPathRef.current = repositoryPath;

  const processingRef = useRef(false);
  const autoStartedRef = useRef(false);
  const prevPhaseRef = useRef(state.phase);
  const archivedRunRef = useRef<string | null>(null);

  useEffect(() => {
    const restored = loadSessionFeedbackLoopState(sessionId);
    const next = restored ?? createInitialFeedbackLoopState(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
    autoStartedRef.current = false;
    prevPhaseRef.current = next.phase;
    archivedRunRef.current = null;
  }, [sessionId, maxCycles]);

  useEffect(() => {
    if (!enabled || !sessionId.trim()) return;
    saveSessionFeedbackLoopState(state);
  }, [enabled, sessionId, state]);

  const habits = useMemo(() => extractFeedbackLoopHabits(state), [state]);

  const historyRecords = useMemo(() => {
    void historyVersion;
    const currentSessionId = state.sessionId;
    return listFeedbackLoopHistory(repositoryPath).filter((r) => r.sessionId !== currentSessionId);
  }, [historyVersion, repositoryPath, state.sessionId]);

  const historyComparison = useMemo(() => {
    const outcome = summarizeFeedbackLoopOutcome(state);
    return compareWithHistoryAverage(historyRecords, outcome.finalOverallScore);
  }, [historyRecords, state]);

  const dispatchAction = useCallback(
    async (action: ReturnType<typeof advanceFeedbackLoop>["action"]) => {
      if (action.type === "send_optimization" && onSendRef.current) {
        await onSendRef.current(action.prompt);
      }
    },
    [],
  );

  const tick = useCallback(
    async (hasNewTurnsSinceOptimization: boolean, stateOverride?: SessionFeedbackLoopState, forceCompare = false) => {
      const currentInsights = insightsRef.current;
      if (!currentInsights || processingRef.current) return;
      const activeState = stateOverride ?? stateRef.current;
      const phase = activeState.phase;
      if (phase !== "running" && phase !== "awaiting_turns") return;

      processingRef.current = true;
      try {
        const { state: next, action } = advanceFeedbackLoop({
          state: activeState,
          insights: currentInsights,
          meta: metaRef.current,
          hasNewTurnsSinceOptimization,
          earlyStopConvergence,
          forceCompare,
        });
        stateRef.current = next;
        setState(next);
        await dispatchAction(action);
      } finally {
        processingRef.current = false;
      }
    },
    [dispatchAction, earlyStopConvergence],
  );

  const finalizeCompletedRun = useCallback(
    async (completed: SessionFeedbackLoopState) => {
      const repo = repoPathRef.current?.trim();
      if (!repo) return;

      const archiveKey = `${completed.sessionId}:${completed.cycles.length}:${completed.completionReason}`;
      if (archivedRunRef.current === archiveKey) return;
      archivedRunRef.current = archiveKey;

      archiveFeedbackLoopHistory({
        state: completed,
        repositoryPath: repo,
        repositoryName: metaRef.current?.repositoryName,
        claudeSessionId: metaRef.current?.claudeSessionId,
      });
      setHistoryVersion((v) => v + 1);

      if (autoSaveHabitsToComposer) {
        const extracted = extractFeedbackLoopHabits(completed);
        if (extracted.length > 0) {
          await upsertFeedbackLoopHabitsPhrase(extracted);
        }
      }
    },
    [autoSaveHabitsToComposer],
  );

  useEffect(() => {
    if (!enabled || !insights) return;
    const phase = state.phase;
    if (phase !== "awaiting_turns") return;

    const turnAtOpt = state.turnCountAtLastOptimization ?? 0;
    const hasNewTurns = insights.overview.turnCount > turnAtOpt;
    if (!hasNewTurns) return;

    void tick(true);
  }, [enabled, insights, state.phase, state.turnCountAtLastOptimization, tick]);

  useEffect(() => {
    if (prevPhaseRef.current !== "completed" && state.phase === "completed") {
      void finalizeCompletedRun(state);
      onCompleteRef.current?.(state);
    }
    prevPhaseRef.current = state.phase;
  }, [finalizeCompletedRun, state]);

  useEffect(() => {
    if (!enabled || !autoStart || !insights || autoStartedRef.current) return;
    if (state.phase !== "idle") return;
    const warnings = insights.recommendations.filter(
      (r) => r.severity === "warning" || r.severity === "critical",
    );
    if (warnings.length === 0) return;
    autoStartedRef.current = true;
    const next = startFeedbackLoop(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
    void tick(false, next);
  }, [autoStart, enabled, insights, maxCycles, sessionId, state.phase, tick]);

  const start = useCallback(() => {
    if (!enabled) return;
    autoStartedRef.current = true;
    archivedRunRef.current = null;
    const next = startFeedbackLoop(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
    void tick(false, next);
  }, [enabled, maxCycles, sessionId, tick]);

  const stop = useCallback(() => {
    setState((prev) => {
      const next = stopFeedbackLoop(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearSessionFeedbackLoopState(sessionId);
    autoStartedRef.current = false;
    archivedRunRef.current = null;
    const next = createInitialFeedbackLoopState(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
  }, [maxCycles, sessionId]);

  const forceCompare = useCallback(() => {
    void tick(true, undefined, true);
  }, [tick]);

  const saveHabitsToComposerManual = useCallback(async (): Promise<boolean> => {
    const extracted = extractFeedbackLoopHabits(stateRef.current);
    if (extracted.length === 0) return false;
    await upsertFeedbackLoopHabitsPhrase(extracted);
    return true;
  }, []);

  const requestFinalSummary = useCallback((): string | null => {
    if (state.cycles.length === 0) return null;
    return buildFeedbackLoopComparisonPrompt(state.cycles, metaRef.current);
  }, [state.cycles]);

  const requestHabitsPrompt = useCallback((): string | null => {
    if (state.cycles.length === 0 && state.phase === "idle") return null;
    return buildFeedbackLoopHabitsPrompt(state, metaRef.current);
  }, [state]);

  const exportMarkdownReport = useCallback((): string | null => {
    if (state.cycles.length === 0 && state.phase === "idle") return null;
    return buildFeedbackLoopMarkdownReport(state, metaRef.current);
  }, [state]);

  const isActive =
    state.phase === "running" || state.phase === "awaiting_turns" || state.phase === "comparing";

  return {
    state,
    isActive,
    habits,
    historyRecords,
    historyComparison,
    start,
    stop,
    reset,
    forceCompare,
    saveHabitsToComposer: saveHabitsToComposerManual,
    requestFinalSummary,
    requestHabitsPrompt,
    exportMarkdownReport,
  };
}
