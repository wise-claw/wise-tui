import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyFeedbackConfigPatches } from "../services/sessionFeedbackConfigPatchApply";
import { listFeedbackConfigPatchBackups } from "../services/sessionFeedbackConfigPatchBackupList";
import type { FeedbackPatchBackupRecord } from "../utils/sessionFeedbackConfigPatchJson";
import {
  attachSessionScoreToRecentPatchRecords,
  formatPatchKindEffectivenessHint,
  rankPatchKindEffectiveness,
  recordPatchApplyBatch,
  type PatchKindEffectivenessSummary,
} from "../services/sessionFeedbackConfigPatchEffectiveness";
import { rollbackFeedbackConfigPatchBackup } from "../services/sessionFeedbackConfigPatchRollback";
import {
  clearFeedbackConfigPatches,
  loadFeedbackConfigPatches,
  mergeFeedbackConfigPatches,
  saveFeedbackConfigPatches,
} from "../services/sessionFeedbackConfigPatchStore";
import { loadFeedbackConfigSnapshot } from "../services/sessionFeedbackConfigSnapshot";
import { upsertFeedbackLoopHabitsPhrase } from "../services/sessionFeedbackLoopComposer";
import {
  archiveFeedbackLoopHistory,
  compareWithHistoryAverage,
  ensureFeedbackLoopHistoryHydrated,
  listFeedbackLoopHistory,
  type FeedbackLoopHistoryRecord,
} from "../services/sessionFeedbackLoopHistoryStore";
import {
  attachSessionFeedbackLoopDispatchComparisonScore,
} from "../stores/sessionFeedbackLoopDispatchStore";
import {
  clearSessionFeedbackLoopState,
  loadSessionFeedbackLoopState,
  saveSessionFeedbackLoopState,
} from "../services/sessionFeedbackLoopStore";
import type { SessionInsightsResult } from "../utils/sessionInsights";
import type { SessionInsightsReportMeta } from "../utils/sessionInsightsReport";
import type {
  FeedbackConfigPatch,
  FeedbackConfigOverheadDelta,
  FeedbackConfigSnapshot,
} from "../utils/sessionFeedbackConfigPatch";
import {
  inferConfigPatchCandidates,
  parseConfigPatchesFromAiResponse,
} from "../utils/sessionFeedbackConfigPatch";
import {
  isLowRiskAutoApplyPatch,
} from "../utils/sessionFeedbackLoopActions";
import {
  canAutoApplyPatch,
  collectRecentlyRolledBackKeys,
  createInitialAutomationGuardState,
  isAutomationCircuitBreakerTripped,
  markPatchAutoApplied,
  markPatchAutoRolledBack,
  resetAutomationCircuitBreaker as resetAutomationCircuitBreakerState,
  resetAutomationGuardForCycle,
  type FeedbackAutomationGuardState,
} from "../utils/feedbackAutomationGuard";
import {
  appendFeedbackAutomationAudit,
  clearFeedbackAutomationAudit,
  listFeedbackAutomationAudit,
  type FeedbackAutomationAuditEntry,
} from "../utils/feedbackAutomationAuditLog";
import {
  advanceFeedbackLoop,
  attachFeedbackCycleWorkerResponse,
  buildFeedbackLoopComparisonPrompt,
  buildFeedbackLoopConfigPatchPrompt,
  buildFeedbackLoopHabitsPrompt,
  buildFeedbackLoopMarkdownReport,
  createInitialFeedbackLoopState,
  extractFeedbackLoopHabits,
  isFeedbackLoopPhaseActive,
  normalizeFeedbackLoopMaxCycles,
  startFeedbackLoop,
  stopFeedbackLoop,
  summarizeFeedbackLoopOutcome,
  type SessionFeedbackLoopState,
} from "../utils/sessionFeedbackLoop";

/** 自动调整：最终分低于历史基线超过该阈值时，视为评分回归并回滚本轮补丁。 */
const FEEDBACK_LOOP_REGRESSION_THRESHOLD = 5;

export interface UseSessionFeedbackLoopInput {
  sessionId: string;
  enabled: boolean;
  maxCycles?: number;
  autoStart?: boolean;
  earlyStopConvergence?: boolean;
  autoSaveHabitsToComposer?: boolean;
  optimizeConfigArtifacts?: boolean;
  /** worker 解析出非破坏性补丁后自动落盘 */
  autoApplyConfigPatches?: boolean;
  /** 评分回归时自动回滚本轮应用的补丁 */
  autoRollbackOnRegression?: boolean;
  /** 补丁应用后自动触发验证轮次 */
  autoVerifyAfterApply?: boolean;
  repositoryPath?: string | null;
  insights: SessionInsightsResult | null;
  meta?: SessionInsightsReportMeta;
  onSendOptimizationPrompt?: (prompt: string, cycleIndex: number) => void | Promise<void>;
  onCycleComplete?: (state: SessionFeedbackLoopState) => void;
}

export interface UseSessionFeedbackLoopResult {
  state: SessionFeedbackLoopState;
  isActive: boolean;
  habits: string[];
  configPatches: FeedbackConfigPatch[];
  configSnapshot: FeedbackConfigSnapshot | null;
  configSnapshotLoading: boolean;
  configOverheadDelta: FeedbackConfigOverheadDelta | null;
  configPatchBackups: FeedbackPatchBackupRecord[];
  configPatchBackupsLoading: boolean;
  patchKindEffectiveness: PatchKindEffectivenessSummary[];
  patchEffectivenessHint: string | null;
  repositoryPath?: string | null;
  historyRecords: FeedbackLoopHistoryRecord[];
  historyComparison: { average: number | null; delta: number | null };
  start: () => void;
  stop: () => void;
  reset: () => void;
  forceCompare: () => void;
  saveHabitsToComposer: () => Promise<boolean>;
  requestFinalSummary: () => string | null;
  requestHabitsPrompt: () => string | null;
  requestConfigPatchPrompt: () => string | null;
  ingestConfigPatchAiResponse: (text: string) => number;
  refreshConfigSnapshot: () => Promise<void>;
  rejectConfigPatch: (patchId: string) => void;
  applySelectedConfigPatches: (patchIds: readonly string[]) => Promise<number>;
  applyLowRiskConfigPatches: () => Promise<number>;
  maybeAutoApplyConfigPatches: () => Promise<number>;
  refreshConfigPatchBackups: () => Promise<void>;
  rollbackConfigPatchBackup: (backupId: string) => Promise<{ ok: boolean; message: string }>;
  exportMarkdownReport: () => string | null;
  ingestCycleWorkerResponse: (cycleIndex: number, responseText: string) => void;
  /** 自动化护栏是否已熔断（连续回滚达阈值，自动应用暂停）。 */
  automationCircuitBreakerTripped: boolean;
  /** 自动化审计日志（apply / rollback / verify / 护栏拦截 / 熔断）。 */
  automationAuditEntries: FeedbackAutomationAuditEntry[];
  /** 清空当前仓库的自动化审计日志。 */
  clearAutomationAudit: () => void;
  /** 手动解除熔断，恢复自动应用。 */
  resetAutomationCircuitBreaker: () => void;
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
    optimizeConfigArtifacts = false,
    autoApplyConfigPatches = false,
    autoRollbackOnRegression = false,
    autoVerifyAfterApply = false,
  } = input;

  const maxCycles = normalizeFeedbackLoopMaxCycles(maxCyclesInput);

  const [state, setState] = useState<SessionFeedbackLoopState>(() => {
    const restored = loadSessionFeedbackLoopState(sessionId);
    return restored ?? createInitialFeedbackLoopState(sessionId, maxCycles);
  });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [configPatches, setConfigPatches] = useState<FeedbackConfigPatch[]>(() =>
    loadFeedbackConfigPatches(sessionId),
  );
  const [configSnapshot, setConfigSnapshot] = useState<FeedbackConfigSnapshot | null>(null);
  const [configSnapshotLoading, setConfigSnapshotLoading] = useState(false);
  const [configOverheadDelta, setConfigOverheadDelta] = useState<FeedbackConfigOverheadDelta | null>(
    null,
  );
  const [configPatchBackups, setConfigPatchBackups] = useState<FeedbackPatchBackupRecord[]>([]);
  const [configPatchBackupsLoading, setConfigPatchBackupsLoading] = useState(false);
  const [effectivenessVersion, setEffectivenessVersion] = useState(0);
  const [auditVersion, setAuditVersion] = useState(0);
  const [circuitBreakerTripped, setCircuitBreakerTripped] = useState(false);

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

  const configSnapshotRef = useRef(configSnapshot);
  configSnapshotRef.current = configSnapshot;

  const autoApplyConfigPatchesRef = useRef(autoApplyConfigPatches);
  autoApplyConfigPatchesRef.current = autoApplyConfigPatches;
  const autoRollbackOnRegressionRef = useRef(autoRollbackOnRegression);
  autoRollbackOnRegressionRef.current = autoRollbackOnRegression;
  const autoVerifyAfterApplyRef = useRef(autoVerifyAfterApply);
  autoVerifyAfterApplyRef.current = autoVerifyAfterApply;

  const configPatchBackupsRef = useRef(configPatchBackups);
  configPatchBackupsRef.current = configPatchBackups;

  /** 本轮运行中已应用补丁的 patchId 集合，用于评分回归时精确回滚。 */
  const runAppliedPatchIdsRef = useRef<Set<string>>(new Set());

  /** 自动化护栏状态（单轮上限 / 连续回滚熔断 / 跨轮幂等去重）。 */
  const automationGuardRef = useRef<FeedbackAutomationGuardState>(
    createInitialAutomationGuardState(),
  );

  const processingRef = useRef(false);
  const autoStartedRef = useRef(false);
  const prevPhaseRef = useRef(state.phase);
  const archivedRunRef = useRef<string | null>(null);

  const refreshConfigSnapshot = useCallback(async () => {
    const repo = repoPathRef.current?.trim();
    if (!repo || !optimizeConfigArtifacts) {
      setConfigSnapshot(null);
      return;
    }
    setConfigSnapshotLoading(true);
    try {
      setConfigSnapshot(await loadFeedbackConfigSnapshot(repo));
    } finally {
      setConfigSnapshotLoading(false);
    }
  }, [optimizeConfigArtifacts]);

  useEffect(() => {
    const restored = loadSessionFeedbackLoopState(sessionId);
    const next = restored ?? createInitialFeedbackLoopState(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
    setConfigPatches(loadFeedbackConfigPatches(sessionId));
    autoStartedRef.current = false;
    prevPhaseRef.current = next.phase;
    archivedRunRef.current = null;
  }, [sessionId, maxCycles]);

  useEffect(() => {
    void ensureFeedbackLoopHistoryHydrated().then(() => {
      setHistoryVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId.trim()) return;
    saveSessionFeedbackLoopState(state);
  }, [enabled, sessionId, state]);

  const refreshConfigPatchBackups = useCallback(async () => {
    const repo = repoPathRef.current?.trim();
    if (!repo || !optimizeConfigArtifacts) {
      setConfigPatchBackups([]);
      return;
    }
    setConfigPatchBackupsLoading(true);
    try {
      setConfigPatchBackups(await listFeedbackConfigPatchBackups(repo, 12));
    } finally {
      setConfigPatchBackupsLoading(false);
    }
  }, [optimizeConfigArtifacts]);

  useEffect(() => {
    if (!enabled || !optimizeConfigArtifacts) return;
    void refreshConfigPatchBackups();
  }, [enabled, optimizeConfigArtifacts, repositoryPath, refreshConfigPatchBackups]);

  const patchKindEffectiveness = useMemo(() => {
    void effectivenessVersion;
    return rankPatchKindEffectiveness(repositoryPath, 4);
  }, [effectivenessVersion, repositoryPath]);

  const patchKindEffectivenessRef = useRef(patchKindEffectiveness);
  patchKindEffectivenessRef.current = patchKindEffectiveness;

  const patchEffectivenessHint = useMemo(
    () => formatPatchKindEffectivenessHint(patchKindEffectiveness),
    [patchKindEffectiveness],
  );

  useEffect(() => {
    if (!enabled || !optimizeConfigArtifacts) return;
    void refreshConfigSnapshot();
  }, [enabled, optimizeConfigArtifacts, repositoryPath, refreshConfigSnapshot]);

  const habits = useMemo(() => extractFeedbackLoopHabits(state), [state]);

  const historyRecords = useMemo(() => {
    void historyVersion;
    const currentSessionId = state.sessionId;
    return listFeedbackLoopHistory(repositoryPath).filter((r) => r.sessionId !== currentSessionId);
  }, [historyVersion, repositoryPath, state.sessionId]);

  const historyRecordsRef = useRef(historyRecords);
  historyRecordsRef.current = historyRecords;

  /** 自动化审计日志（可观测），随 auditVersion 与仓库变化刷新。 */
  const automationAuditEntries = useMemo(() => {
    void auditVersion;
    return listFeedbackAutomationAudit(repositoryPath, 30);
  }, [auditVersion, repositoryPath]);

  // 仓库或审计变化时，从审计日志重建「近期自动回滚补丁键集合」，供护栏跨轮去重。
  useEffect(() => {
    const repo = repositoryPath?.trim();
    if (!repo) return;
    automationGuardRef.current.recentlyRolledBackKeys = collectRecentlyRolledBackKeys(
      listFeedbackAutomationAudit(repo, 20),
    );
  }, [repositoryPath, auditVersion]);

  const historyComparison = useMemo(() => {
    const outcome = summarizeFeedbackLoopOutcome(state);
    return compareWithHistoryAverage(historyRecords, outcome.finalOverallScore);
  }, [historyRecords, state]);

  const syncConfigPatchCandidates = useCallback(() => {
    const currentInsights = insightsRef.current;
    if (!currentInsights || !optimizeConfigArtifacts) return;
    const candidates = inferConfigPatchCandidates({
      insights: currentInsights,
      snapshot: configSnapshotRef.current,
      effectivenessHints: patchKindEffectivenessRef.current,
    });
    const merged = mergeFeedbackConfigPatches(sessionId, candidates);
    setConfigPatches(merged);
  }, [optimizeConfigArtifacts, sessionId]);

  const dispatchAction = useCallback(
    async (action: ReturnType<typeof advanceFeedbackLoop>["action"]) => {
      if (action.type === "send_optimization" && onSendRef.current) {
        await onSendRef.current(action.prompt, action.cycleIndex);
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
        const prevCompared = new Set(
          activeState.cycles.filter((c) => c.comparison).map((c) => c.cycleIndex),
        );
        const { state: next, action } = advanceFeedbackLoop({
          state: activeState,
          insights: currentInsights,
          meta: metaRef.current,
          hasNewTurnsSinceOptimization,
          earlyStopConvergence,
          forceCompare,
          optimizeConfigArtifacts,
          configSnapshot: configSnapshotRef.current,
        });
        for (const cycle of next.cycles) {
          if (cycle.comparison && !prevCompared.has(cycle.cycleIndex)) {
            attachSessionFeedbackLoopDispatchComparisonScore({
              anchorSessionId: sessionId,
              cycleIndex: cycle.cycleIndex,
              comparisonOverallScore: cycle.comparison.overallScore,
            });
          }
        }
        stateRef.current = next;
        setState(next);
        await dispatchAction(action);
        if (action.type === "send_optimization" && optimizeConfigArtifacts) {
          syncConfigPatchCandidates();
        }
      } finally {
        processingRef.current = false;
      }
    },
    [dispatchAction, earlyStopConvergence, optimizeConfigArtifacts, sessionId, syncConfigPatchCandidates],
  );

  const finalizeCompletedRun = useCallback(
    async (completed: SessionFeedbackLoopState) => {
      const repo = repoPathRef.current?.trim();
      if (optimizeConfigArtifacts) {
        syncConfigPatchCandidates();
      }
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

      const outcome = summarizeFeedbackLoopOutcome(completed);
      attachSessionScoreToRecentPatchRecords({
        repositoryPath: repo,
        sessionFinalScore: outcome.finalOverallScore,
      });
      setEffectivenessVersion((v) => v + 1);

      let didRollback = false;
      // 自动调整：最终分显著低于历史基线时，回滚本轮应用的补丁备份。
      // 基线取归档前的历史平均分（不含本次），delta = 本次分 - 基线。
      if (autoRollbackOnRegressionRef.current) {
        const finalScore = outcome.finalOverallScore;
        const baseline = compareWithHistoryAverage(historyRecordsRef.current, finalScore);
        if (
          finalScore != null &&
          baseline.average != null &&
          baseline.delta != null &&
          baseline.delta <= -FEEDBACK_LOOP_REGRESSION_THRESHOLD
        ) {
          const appliedIds = runAppliedPatchIdsRef.current;
          if (appliedIds.size > 0) {
            const targets = configPatchBackupsRef.current.filter((b) =>
              appliedIds.has(b.patchId),
            );
            const guard = automationGuardRef.current;
            let rolledBack = 0;
            for (const backup of targets) {
              const result = await rollbackFeedbackConfigPatchBackup({
                repositoryPath: repo,
                backup,
              });
              if (!result.ok) continue;
              rolledBack += 1;
              // 用备份元数据派生补丁，登记护栏熔断计数与审计。
              const rolledPatch: FeedbackConfigPatch = {
                id: backup.patchId,
                kind: backup.kind,
                action: backup.action,
                path: backup.path,
                rationale: backup.rationale || "评分回归自动回滚",
                content: "",
                source: "ai",
                status: "rejected",
              };
              markPatchAutoRolledBack(guard, rolledPatch);
              appendFeedbackAutomationAudit({
                repositoryPath: repo,
                action: "auto_rollback",
                patch: rolledPatch,
                reason: `评分低于基线 ${Math.abs(baseline.delta).toFixed(1)} 分，自动回滚`,
              });
            }
            if (rolledBack > 0) {
              didRollback = true;
              appliedIds.clear();
              const tripped = isAutomationCircuitBreakerTripped(guard);
              setCircuitBreakerTripped(tripped);
              if (tripped) {
                appendFeedbackAutomationAudit({
                  repositoryPath: repo,
                  action: "circuit_breaker",
                  reason: `连续回滚 ${guard.consecutiveRollbacks} 次达熔断阈值，自动应用暂停`,
                });
              }
              setAuditVersion((v) => v + 1);
              void refreshConfigSnapshot();
              void refreshConfigPatchBackups();
              message.warning(
                `反馈神经网：评分低于基线 ${Math.abs(baseline.delta).toFixed(1)} 分，已自动回滚 ${rolledBack} 条补丁`,
              );
            }
          }
        }
      }

      // 本轮无回滚完成：清零连续回滚计数，熔断自动解除（若有）。
      if (!didRollback && automationGuardRef.current.consecutiveRollbacks > 0) {
        resetAutomationCircuitBreakerState(automationGuardRef.current);
        setCircuitBreakerTripped(false);
        appendFeedbackAutomationAudit({
          repositoryPath: repo,
          action: "circuit_reset",
          reason: "本轮无回滚完成，连续回滚计数清零，熔断自动解除",
        });
        setAuditVersion((v) => v + 1);
      }

      if (autoSaveHabitsToComposer) {
        const extracted = extractFeedbackLoopHabits(completed);
        if (extracted.length > 0) {
          await upsertFeedbackLoopHabitsPhrase(extracted);
        }
      }
    },
    [
      autoSaveHabitsToComposer,
      optimizeConfigArtifacts,
      refreshConfigPatchBackups,
      refreshConfigSnapshot,
      syncConfigPatchCandidates,
    ],
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
    runAppliedPatchIdsRef.current = new Set();
    automationGuardRef.current = resetAutomationGuardForCycle(automationGuardRef.current);
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
    clearFeedbackConfigPatches(sessionId);
    autoStartedRef.current = false;
    archivedRunRef.current = null;
    runAppliedPatchIdsRef.current = new Set();
    automationGuardRef.current = resetAutomationGuardForCycle(automationGuardRef.current);
    const next = createInitialFeedbackLoopState(sessionId, maxCycles);
    stateRef.current = next;
    setState(next);
    setConfigPatches([]);
  }, [maxCycles, sessionId]);

  const forceCompare = useCallback(() => {
    void tick(true, undefined, true);
  }, [tick]);

  const forceCompareRef = useRef<() => void>(forceCompare);
  forceCompareRef.current = forceCompare;

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

  const requestConfigPatchPrompt = useCallback((): string | null => {
    const currentInsights = insightsRef.current;
    if (!currentInsights || !optimizeConfigArtifacts) return null;
    return buildFeedbackLoopConfigPatchPrompt({
      insights: currentInsights,
      loopState: stateRef.current,
      snapshot: configSnapshotRef.current,
      meta: metaRef.current,
      existingPatches: configPatches,
      effectivenessHints: patchKindEffectivenessRef.current,
    });
  }, [configPatches, optimizeConfigArtifacts]);

  const ingestConfigPatchAiResponse = useCallback(
    (text: string): number => {
      const parsed = parseConfigPatchesFromAiResponse(text);
      if (parsed.length === 0) return 0;
      const merged = mergeFeedbackConfigPatches(sessionId, parsed);
      setConfigPatches(merged);
      return parsed.length;
    },
    [sessionId],
  );

  const rejectConfigPatch = useCallback(
    (patchId: string) => {
      const next = loadFeedbackConfigPatches(sessionId).map((patch) =>
        patch.id === patchId ? { ...patch, status: "rejected" as const } : patch,
      );
      saveFeedbackConfigPatches(sessionId, next);
      setConfigPatches(next);
    },
    [sessionId],
  );

  const applySelectedConfigPatches = useCallback(
    async (patchIds: readonly string[]): Promise<number> => {
      const repo = repoPathRef.current?.trim();
      if (!repo) return 0;
      const idSet = new Set(patchIds);
      const pending = loadFeedbackConfigPatches(sessionId).filter(
        (p) => idSet.has(p.id) && p.status === "pending",
      );
      if (pending.length === 0) return 0;

      const overheadBefore = configSnapshotRef.current?.overhead;
      const results = await applyFeedbackConfigPatches({ repositoryPath: repo, patches: pending });
      const applied = results.filter((r) => r.status === "applied");
      const resultById = new Map(results.map((r) => [r.id, r]));
      const next = loadFeedbackConfigPatches(sessionId).map(
        (patch) => resultById.get(patch.id) ?? patch,
      );
      saveFeedbackConfigPatches(sessionId, next);
      setConfigPatches(next);

      let overheadDelta: FeedbackConfigOverheadDelta | null = null;
      const freshSnapshot = await loadFeedbackConfigSnapshot(repo);
      if (freshSnapshot) {
        setConfigSnapshot(freshSnapshot);
        configSnapshotRef.current = freshSnapshot;
        if (overheadBefore) {
          overheadDelta = {
            rules: freshSnapshot.overhead.rules - overheadBefore.rules,
            skills: freshSnapshot.overhead.skills - overheadBefore.skills,
            mcp: freshSnapshot.overhead.mcp - overheadBefore.mcp,
            subagents: freshSnapshot.overhead.subagents - overheadBefore.subagents,
            capturedAt: Date.now(),
          };
          setConfigOverheadDelta(overheadDelta);
        }
      }

      if (applied.length > 0) {
        for (const patch of applied) {
          runAppliedPatchIdsRef.current.add(patch.id);
        }
        recordPatchApplyBatch({
          repositoryPath: repo,
          appliedPatches: applied,
          overheadDelta,
        });
        setEffectivenessVersion((v) => v + 1);

        // 自动优化：补丁落盘后若开启自动验证，触发一次比对将补丁效果纳入循环评分。
        // 仅在循环仍处于活跃阶段（running / awaiting_turns）时生效；已完成循环不重启。
        if (autoVerifyAfterApplyRef.current) {
          const phase = stateRef.current.phase;
          const active = isFeedbackLoopPhaseActive(phase);
          appendFeedbackAutomationAudit({
            repositoryPath: repo,
            action: "auto_verify",
            outcome: active ? "success" : "skipped",
            reason: active
              ? `补丁落盘后自动触发验证轮次，纳入 ${applied.length} 条补丁效果`
              : `循环已结束（${phase}），跳过自动验证`,
          });
          setAuditVersion((v) => v + 1);
          forceCompareRef.current();
        }
      }

      void refreshConfigPatchBackups();

      return applied.length;
    },
    [refreshConfigPatchBackups, sessionId],
  );

  const applyLowRiskConfigPatches = useCallback(async (): Promise<number> => {
    const pending = loadFeedbackConfigPatches(sessionId).filter(
      (patch) => patch.status === "pending" && isLowRiskAutoApplyPatch(patch),
    );
    if (pending.length === 0) return 0;
    return applySelectedConfigPatches(pending.map((patch) => patch.id));
  }, [applySelectedConfigPatches, sessionId]);

  /**
   * 自动写入：worker 解析出非破坏性补丁后，若开启自动应用则立即落盘低风险补丁。
   * 由调用方（onComplete）在补丁解析完成后调用。返回应用的补丁数。
   * 经护栏守卫（单轮上限 / 连续回滚熔断 / 跨轮幂等去重），被拦截的补丁记审计。
   */
  const maybeAutoApplyConfigPatches = useCallback(async (): Promise<number> => {
    if (!autoApplyConfigPatchesRef.current) return 0;
    const repo = repoPathRef.current?.trim();
    if (!repo) return 0;
    const pending = loadFeedbackConfigPatches(sessionId).filter(
      (patch) => patch.status === "pending" && isLowRiskAutoApplyPatch(patch),
    );
    if (pending.length === 0) return 0;

    const guard = automationGuardRef.current;
    const allowed: FeedbackConfigPatch[] = [];
    for (const patch of pending) {
      const decision = canAutoApplyPatch(patch, guard);
      if (decision.allowed) {
        allowed.push(patch);
      } else {
        appendFeedbackAutomationAudit({
          repositoryPath: repo,
          action: "guard_block",
          outcome: "skipped",
          patch,
          reason: decision.reason ?? "护栏拦截",
        });
      }
    }
    if (allowed.length === 0) {
      setAuditVersion((v) => v + 1);
      return 0;
    }

    const appliedCount = await applySelectedConfigPatches(allowed.map((p) => p.id));
    if (appliedCount > 0) {
      // 取落盘后最新状态登记护栏计数与审计（仅记实际 applied 的补丁）。
      const latest = loadFeedbackConfigPatches(sessionId);
      let registered = 0;
      for (const patch of allowed) {
        if (registered >= appliedCount) break;
        const fresh = latest.find((p) => p.id === patch.id);
        if (!fresh || fresh.status !== "applied") continue;
        markPatchAutoApplied(guard, fresh);
        appendFeedbackAutomationAudit({
          repositoryPath: repo,
          action: "auto_apply",
          patch: fresh,
          reason: fresh.rationale,
        });
        registered += 1;
      }
      setAuditVersion((v) => v + 1);
    }
    return appliedCount;
  }, [applySelectedConfigPatches, sessionId]);

  const rollbackConfigPatchBackup = useCallback(
    async (backupId: string): Promise<{ ok: boolean; message: string }> => {
      const repo = repoPathRef.current?.trim();
      if (!repo) return { ok: false, message: "缺少仓库路径" };
      const backup = configPatchBackups.find((b) => b.backupId === backupId);
      if (!backup) return { ok: false, message: "未找到备份记录" };
      const result = await rollbackFeedbackConfigPatchBackup({ repositoryPath: repo, backup });
      if (result.ok) {
        void refreshConfigSnapshot();
        void refreshConfigPatchBackups();
      }
      return result;
    },
    [configPatchBackups, refreshConfigPatchBackups, refreshConfigSnapshot],
  );

  /** 清空当前仓库的自动化审计日志。 */
  const clearAutomationAudit = useCallback(() => {
    clearFeedbackAutomationAudit(repositoryPath);
    setAuditVersion((v) => v + 1);
  }, [repositoryPath]);

  /** 手动解除熔断，恢复自动应用（连续回滚计数清零）。 */
  const resetAutomationCircuitBreaker = useCallback(() => {
    resetAutomationCircuitBreakerState(automationGuardRef.current);
    setCircuitBreakerTripped(false);
    const repo = repoPathRef.current?.trim();
    if (repo) {
      appendFeedbackAutomationAudit({
        repositoryPath: repo,
        action: "circuit_reset",
        reason: "用户手动重置熔断，恢复自动应用",
      });
      setAuditVersion((v) => v + 1);
    }
  }, []);

  const exportMarkdownReport = useCallback((): string | null => {
    if (state.cycles.length === 0 && state.phase === "idle") return null;
    return buildFeedbackLoopMarkdownReport(state, metaRef.current, {
      insights: insightsRef.current ?? undefined,
    });
  }, [state]);

  const ingestCycleWorkerResponse = useCallback((cycleIndex: number, responseText: string) => {
    setState((prev) => {
      const next = attachFeedbackCycleWorkerResponse(prev, cycleIndex, responseText);
      stateRef.current = next;
      return next;
    });
  }, []);

  const isActive = isFeedbackLoopPhaseActive(state.phase);

  return {
    state,
    isActive,
    habits,
    configPatches,
    configSnapshot,
    configSnapshotLoading,
    configOverheadDelta,
    configPatchBackups,
    configPatchBackupsLoading,
    patchKindEffectiveness,
    patchEffectivenessHint,
    repositoryPath: repositoryPath ?? null,
    historyRecords,
    historyComparison,
    start,
    stop,
    reset,
    forceCompare,
    saveHabitsToComposer: saveHabitsToComposerManual,
    requestFinalSummary,
    requestHabitsPrompt,
    requestConfigPatchPrompt,
    ingestConfigPatchAiResponse,
    refreshConfigSnapshot,
    rejectConfigPatch,
    applySelectedConfigPatches,
    applyLowRiskConfigPatches,
    maybeAutoApplyConfigPatches,
    refreshConfigPatchBackups,
    rollbackConfigPatchBackup,
    exportMarkdownReport,
    ingestCycleWorkerResponse,
    automationCircuitBreakerTripped: circuitBreakerTripped,
    automationAuditEntries,
    clearAutomationAudit,
    resetAutomationCircuitBreaker,
  };
}
