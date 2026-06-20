import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession } from "../types";
import { loadClaudeSessionJsonl } from "../services/claudeDisk";
import { useFccSessionTraces } from "./useFccSessionTraces";
import { useOpencodeGoSessionTraces } from "./useOpencodeGoSessionTraces";
import {
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  retainClaudeLlmProxyStdoutIngest,
  subscribeClaudeLlmProxyStore,
} from "../stores/claudeLlmProxyStore";
import { getSessionContextMetrics } from "../services/claudeSessionContext";
import { aggregateSessionLinkRecords } from "../utils/sessionLinkFilters";
import { filterLlmProxyRecordsForDisplay } from "../utils/llmProxyTrafficDisplay";
import { buildSessionLinkPipeline } from "../utils/sessionLinkPipeline";
import {
  computeSessionInsights,
  filterJsonlLinesForUsageScan,
} from "../utils/sessionInsights";
import { useSessionFeedbackLoopSetting } from "../components/DefaultConfigPanel/useSessionFeedbackLoopSetting";
import { useRepositoryUsageBaseline } from "./useRepositoryUsageBaseline";
import { useSessionFeedbackLoop } from "./useSessionFeedbackLoop";
import { useSessionFeedbackLoopDispatchCompletion } from "./useSessionFeedbackLoopDispatchCompletion";
import { loadSessionFeedbackLoopState } from "../services/sessionFeedbackLoopStore";
import {
  shouldTrackSessionLinkForFeedbackLoop,
  type FeedbackLoopPhase,
} from "../utils/sessionFeedbackLoop";
import type { FeedbackLoopDispatchKind } from "../utils/sessionFeedbackLoopDispatch";
import type { UseSessionFeedbackLoopResult } from "./useSessionFeedbackLoop";
import type { SessionInsightsResult } from "../utils/sessionInsights";

const JSONL_TAIL_FULL = 8000;
const JSONL_TAIL_LIGHT = 1200;

export interface UseSessionFeedbackLoopWorkspaceInput {
  session: ClaudeSession | null;
  /** 反馈神经网抽屉是否打开 */
  drawerOpen: boolean;
  onDispatchSessionFeedbackLoop?: (input: {
    anchorSessionId: string;
    prompt: string;
    kind: FeedbackLoopDispatchKind;
    cycleIndex?: number;
  }) => void | Promise<void>;
  getClaudeSessions?: () => readonly ClaudeSession[];
}

export interface UseSessionFeedbackLoopWorkspaceResult {
  setting: ReturnType<typeof useSessionFeedbackLoopSetting>;
  loop: UseSessionFeedbackLoopResult;
  insights: SessionInsightsResult | null;
  linkDataLoading: boolean;
}

export function useSessionFeedbackLoopWorkspace(
  input: UseSessionFeedbackLoopWorkspaceInput,
): UseSessionFeedbackLoopWorkspaceResult {
  const { session, drawerOpen, onDispatchSessionFeedbackLoop, getClaudeSessions } = input;
  const feedbackLoopSetting = useSessionFeedbackLoopSetting();

  const messages = session?.messages ?? [];
  const repositoryPath = session?.repositoryPath?.trim() ?? "";
  const claudeSessionId = session?.claudeSessionId?.trim() ?? "";
  const canLoadDisk = Boolean(repositoryPath && claudeSessionId);
  const sessionId = session?.id?.trim() ?? "";

  const storedLoopPhase = useMemo((): FeedbackLoopPhase => {
    if (!sessionId) return "idle";
    return loadSessionFeedbackLoopState(sessionId)?.phase ?? "idle";
  }, [sessionId]);
  const [trackedLoopPhase, setTrackedLoopPhase] = useState<FeedbackLoopPhase>(storedLoopPhase);

  useEffect(() => {
    setTrackedLoopPhase(storedLoopPhase);
  }, [sessionId, storedLoopPhase]);

  const linkDataActive = shouldTrackSessionLinkForFeedbackLoop({
    drawerOpen,
    feedbackLoopEnabled: feedbackLoopSetting.enabled,
    autoStart: feedbackLoopSetting.autoStart,
    loopPhase: trackedLoopPhase,
  });

  const [jsonlLines, setJsonlLines] = useState<string[] | null>(null);
  const [jsonlLoading, setJsonlLoading] = useState(false);
  const [proxySnap, setProxySnap] = useState(getClaudeLlmProxyStoreSnapshot);

  useEffect(() => {
    if (!linkDataActive) return;
    const releaseStdoutIngest = retainClaudeLlmProxyStdoutIngest();
    void refreshClaudeLlmProxyStatus(repositoryPath || undefined);
    const unsubscribe = subscribeClaudeLlmProxyStore(() => {
      setProxySnap(getClaudeLlmProxyStoreSnapshot());
    });
    return () => {
      unsubscribe();
      releaseStdoutIngest();
    };
  }, [linkDataActive, repositoryPath]);

  useEffect(() => {
    if (!linkDataActive) return;
    setJsonlLines(null);
    if (!canLoadDisk) return;
    const tailLines =
      session?.diskTranscriptPartial || messages.length < 80 ? JSONL_TAIL_FULL : JSONL_TAIL_LIGHT;
    let cancelled = false;
    setJsonlLoading(true);
    void loadClaudeSessionJsonl(repositoryPath, claudeSessionId, { tailLines })
      .then((lines) => {
        if (!cancelled) setJsonlLines(lines);
      })
      .catch(() => {
        if (!cancelled) setJsonlLines([]);
      })
      .finally(() => {
        if (!cancelled) setJsonlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    linkDataActive,
    canLoadDisk,
    repositoryPath,
    claudeSessionId,
    session?.diskTranscriptPartial,
    messages.length,
  ]);

  const traceSinceMs = session?.createdAt ? session.createdAt - 60_000 : undefined;
  const { fccAligned, traces: fccTraces } = useFccSessionTraces({
    open: linkDataActive,
    sessionHint: claudeSessionId || undefined,
    sinceMs: traceSinceMs,
  });
  const { proxyAligned: opencodeAligned, traces: opencodeGoTraces } = useOpencodeGoSessionTraces({
    open: linkDataActive,
    sinceMs: traceSinceMs,
  });

  const llmProxyRecords = useMemo(
    () =>
      filterLlmProxyRecordsForDisplay(proxySnap.records, {
        hideStreamJsonWhenProxyActive:
          proxySnap.status?.listening === true && proxySnap.status?.running === true,
      }),
    [proxySnap.records, proxySnap.status?.listening, proxySnap.status?.running],
  );

  const linkPipeline = useMemo(
    () =>
      buildSessionLinkPipeline({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        llmProxyRecords,
        fccTraces: fccAligned ? fccTraces : undefined,
        opencodeGoProxyTraces: opencodeAligned ? opencodeGoTraces : undefined,
      }),
    [messages, jsonlLines, llmProxyRecords, fccAligned, fccTraces, opencodeAligned, opencodeGoTraces],
  );

  const { turnMetrics } = useMemo(
    () => aggregateSessionLinkRecords(linkPipeline.records),
    [linkPipeline.records],
  );

  const jsonlUsageLines = useMemo(
    () => filterJsonlLinesForUsageScan(jsonlLines),
    [jsonlLines],
  );

  const repositoryBaseline = useRepositoryUsageBaseline(session?.repositoryPath);

  const loopInsights = useMemo(() => {
    if (!linkDataActive) return null;
    const contextMetrics = session ? getSessionContextMetrics(session) : null;
    return computeSessionInsights({
      linkRecords: linkPipeline.records,
      turnMetrics,
      llmProxyRecords,
      fccTraces: fccAligned ? fccTraces : undefined,
      opencodeGoProxyTraces: opencodeAligned ? opencodeGoTraces : undefined,
      jsonlUsageLines,
      llmProxyListening: proxySnap.status?.listening ?? false,
      contextMetrics,
      repositoryBaseline,
    });
  }, [
    linkDataActive,
    linkPipeline.records,
    turnMetrics,
    llmProxyRecords,
    fccAligned,
    fccTraces,
    opencodeAligned,
    opencodeGoTraces,
    jsonlUsageLines,
    proxySnap.status?.listening,
    session,
    repositoryBaseline,
  ]);

  const dispatchFeedbackLoopRef = useRef(onDispatchSessionFeedbackLoop);
  dispatchFeedbackLoopRef.current = onDispatchSessionFeedbackLoop;

  const dispatchFeedbackLoopPrompt = useCallback(
    async (prompt: string, kind: FeedbackLoopDispatchKind, cycleIndex?: number) => {
      const dispatch = dispatchFeedbackLoopRef.current;
      if (!dispatch || !session?.id) return;
      await dispatch({
        anchorSessionId: session.id,
        prompt,
        kind,
        cycleIndex,
      });
    },
    [session?.id],
  );

  const feedbackLoop = useSessionFeedbackLoop({
    sessionId: sessionId,
    enabled: feedbackLoopSetting.enabled,
    maxCycles: feedbackLoopSetting.maxCycles,
    autoStart: feedbackLoopSetting.autoStart,
    earlyStopConvergence: feedbackLoopSetting.earlyStopConvergence,
    autoSaveHabitsToComposer: feedbackLoopSetting.autoSaveHabitsToComposer,
    optimizeConfigArtifacts: feedbackLoopSetting.optimizeConfigArtifacts,
    autoApplyConfigPatches: feedbackLoopSetting.autoApplyConfigPatches,
    autoRollbackOnRegression: feedbackLoopSetting.autoRollbackOnRegression,
    autoVerifyAfterApply: feedbackLoopSetting.autoVerifyAfterApply,
    repositoryPath: session?.repositoryPath,
    insights: loopInsights,
    meta: session
      ? {
          repositoryName: session.repositoryName.trim() || undefined,
          claudeSessionId: session.claudeSessionId,
        }
      : undefined,
    onSendOptimizationPrompt: onDispatchSessionFeedbackLoop
      ? async (prompt, cycleIndex) => {
          await dispatchFeedbackLoopPrompt(prompt, "optimization", cycleIndex);
        }
      : undefined,
    onCycleComplete: (completed) => {
      const reason =
        completed.completionReason === "converged"
          ? "指标已收敛"
          : completed.completionReason === "max_cycles"
            ? "已达最大循环次数"
            : "循环结束";
      const habitsHint = [
        feedbackLoopSetting.autoSaveHabitsToComposer ? "习惯已写入常用语" : "",
        feedbackLoopSetting.injectHabitsToSystemPrompt ? "习惯将注入新会话 System Prompt" : "",
      ]
        .filter(Boolean)
        .join("，");
      message.success(`反馈神经网：${reason}${habitsHint ? `，${habitsHint}` : ""}`);
    },
  });

  useEffect(() => {
    setTrackedLoopPhase(feedbackLoop.state.phase);
  }, [feedbackLoop.state.phase]);

  const ingestConfigPatchRef = useRef(feedbackLoop.ingestConfigPatchAiResponse);
  ingestConfigPatchRef.current = feedbackLoop.ingestConfigPatchAiResponse;
  const ingestCycleWorkerRef = useRef(feedbackLoop.ingestCycleWorkerResponse);
  ingestCycleWorkerRef.current = feedbackLoop.ingestCycleWorkerResponse;
  const maybeAutoApplyConfigPatchesRef = useRef(feedbackLoop.maybeAutoApplyConfigPatches);
  maybeAutoApplyConfigPatchesRef.current = feedbackLoop.maybeAutoApplyConfigPatches;

  useSessionFeedbackLoopDispatchCompletion({
    anchorSessionId: sessionId,
    getSessions: getClaudeSessions ?? (() => []),
    onComplete: (record, responseText) => {
      if (record.kind === "optimization" && record.cycleIndex != null) {
        ingestCycleWorkerRef.current(record.cycleIndex, responseText);
      }
      if (record.kind === "config_patch" || record.kind === "optimization") {
        const count = ingestConfigPatchRef.current(responseText);
        if (count > 0) {
          message.success(`神经网 worker 已解析 ${count} 条配置补丁，可在抽屉中审阅`);
          // 自动写入：worker 解析出补丁后，若开启自动应用则立即落盘低风险补丁。
          void maybeAutoApplyConfigPatchesRef.current().then((applied) => {
            if (applied > 0) {
              message.success(`反馈神经网：已自动应用 ${applied} 条低风险补丁`);
            }
          });
        }
      }
    },
  });

  return {
    setting: feedbackLoopSetting,
    loop: feedbackLoop,
    insights: loopInsights,
    linkDataLoading: jsonlLoading && linkDataActive,
  };
}
