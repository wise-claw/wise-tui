import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  Modal,
  Dropdown,
  Segmented,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  ToolOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  ApiOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession } from "../../types";
import type { SessionLinkRecord } from "../../types/sessionLink";
import { loadClaudeSessionJsonl } from "../../services/claudeDisk";
import { useFccSessionTraces } from "../../hooks/useFccSessionTraces";
import { useOpencodeGoSessionTraces } from "../../hooks/useOpencodeGoSessionTraces";
import { writeTextFileAbsolute } from "../../services/sessionLink";
import {
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  retainClaudeLlmProxyStdoutIngest,
  subscribeClaudeLlmProxyStore,
} from "../../stores/claudeLlmProxyStore";
import {
  SESSION_LINK_FILTER_OPTIONS,
  aggregateSessionLinkRecords,
  deriveTimestampRangeFromTurnMetrics,
  filterSessionLinkRecords,
  filterSessionLinkRecordsByTurnRange,
  filterTurnMetricsByTurnRange,
  type SessionLinkFilterPreset,
  type TurnRange,
} from "../../utils/sessionLinkFilters";
import {
  formatHttpBodyJsonForDisplay,
  formatHttpTraceDetailForDisplay,
} from "../../utils/formatHttpBodyJson";
import { filterLlmProxyRecordsForDisplay } from "../../utils/llmProxyTrafficDisplay";
import { buildSessionLinkPipeline } from "../../utils/sessionLinkPipeline";
import {
  buildSessionLinkExportBundle,
  serializeSessionLinkExportBundle,
  stripSessionLinkDetailsForMetadataExport,
} from "../../utils/sessionLinkExport";
import {
  computeSessionInsights,
  filterJsonlLinesForUsageScan,
  parseJsonlUsageRow,
} from "../../utils/sessionInsights";
import type { SessionDataLinkOpenView } from "../../stores/claudeUsageUiStore";
import { SessionInsightsPanel } from "./SessionInsightsPanel";
import { useSessionFeedbackLoopSetting } from "../DefaultConfigPanel/useSessionFeedbackLoopSetting";
import { useSessionFeedbackLoop } from "../../hooks/useSessionFeedbackLoop";
import { useSessionFeedbackLoopDispatchCompletion } from "../../hooks/useSessionFeedbackLoopDispatchCompletion";
import type { FeedbackLoopDispatchKind } from "../../utils/sessionFeedbackLoopDispatch";
import { loadSessionFeedbackLoopState } from "../../services/sessionFeedbackLoopStore";
import {
  shouldTrackSessionLinkForFeedbackLoop,
  type FeedbackLoopPhase,
} from "../../utils/sessionFeedbackLoop";
import {
  filterSequenceEventsForTurn,
  filterSequenceEventsForTurnRange,
} from "../../utils/claudeSessionTrajectorySequence";
import { ClaudeSessionSequenceDiagram } from "./ClaudeSessionSequenceDiagram";
import "./SessionDataLinkDrawer.css";

const { Text } = Typography;

const JSONL_TAIL_FULL = 8000;
const JSONL_TAIL_LIGHT = 1200;

const LAYER_LABELS: Record<SessionLinkRecord["layer"], string> = {
  input: "输入",
  protocol: "协议",
  tool: "工具",
  hook: "Hook",
  http: "HTTP",
  fcc_upstream: "FCC 上游",
};

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function shouldShowSourceTag(source: string): boolean {
  const s = source.trim();
  return s.length > 0 && s !== "memory" && s !== "message";
}

function formatRecordDetail(detail: string, record: SessionLinkRecord): string {
  if (record.layer === "http" || record.kind === "api_request") {
    return formatHttpTraceDetailForDisplay(detail);
  }
  return formatHttpBodyJsonForDisplay(detail);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

interface RecordItemProps {
  record: SessionLinkRecord;
}

function RecordItem({ record }: RecordItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  const detailText = record.detail?.trim() ?? "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(detailText);
      setCopied(true);
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      message.error("复制失败");
    }
  };

  return (
    <li
      className={`app-session-data-link__record app-session-data-link__record--layer-${record.layer} ${
        record.kind === "api_request" && !record.observed
          ? "app-session-data-link__record--inferred"
          : ""
      }`}
    >
      <div className="app-session-data-link__record-node" />
      <div className="app-session-data-link__record-body">
        <div className="app-session-data-link__record-head">
          <span className="app-session-data-link__record-time">
            {formatTime(record.timestampMs)}
          </span>
          <span className="app-session-data-link__layer-dot" />
          <span className="app-session-data-link__layer-text">
            {LAYER_LABELS[record.layer]}
          </span>
          {record.layer === "http" ? (
            <span className={`app-session-data-link__badge app-session-data-link__badge--${record.observed ? "observed" : "inferred"}`}>
              {record.observed ? "已观测" : "推断"}
            </span>
          ) : null}
          {shouldShowSourceTag(record.source) ? (
            <span className="app-session-data-link__source-badge">
              {record.source}
            </span>
          ) : null}

          {detailText ? (
            <span
              className={`app-session-data-link__detail-toggle ${expanded ? "expanded" : ""}`}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "收起" : "详情"}
              {expanded ? <DownOutlined style={{ fontSize: 9, marginLeft: 2 }} /> : <RightOutlined style={{ fontSize: 9, marginLeft: 2 }} />}
            </span>
          ) : null}
        </div>

        <div className="app-session-data-link__record-summary">
          {record.summary}
        </div>

        {detailText && expanded ? (
          <div className="app-session-data-link__console">
            <div className="app-session-data-link__console-header">
              <div className="app-session-data-link__console-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <span className="app-session-data-link__console-title">
                {record.layer === "http" || record.kind === "api_request" ? "HTTP TRACE" : "PAYLOAD"}
              </span>
              <span
                className={`app-session-data-link__console-copy ${copied ? "copied" : ""}`}
                onClick={handleCopy}
              >
                {copied ? <CheckOutlined style={{ color: "#10b981", fontSize: 10 }} /> : <CopyOutlined style={{ fontSize: 10 }} />}
                <span className="copy-label">{copied ? "已复制" : "复制"}</span>
              </span>
            </div>
            <pre className="app-session-data-link__console-body">
              {formatRecordDetail(detailText, record)}
            </pre>
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  session: ClaudeSession | null;
  initialViewMode?: SessionDataLinkOpenView;
  /** 将 AI 深度解读 prompt 发往主会话（通常关闭抽屉并 execute） */
  onRequestAiAnalysis?: (prompt: string) => void | Promise<void>;
  /** 反馈神经网：派至独立 worker 会话 */
  onDispatchSessionFeedbackLoop?: (input: {
    anchorSessionId: string;
    prompt: string;
    kind: FeedbackLoopDispatchKind;
    cycleIndex?: number;
  }) => void | Promise<void>;
  getClaudeSessions?: () => readonly ClaudeSession[];
}

export function SessionDataLinkDrawer({
  open,
  onClose,
  session,
  initialViewMode = "list",
  onRequestAiAnalysis,
  onDispatchSessionFeedbackLoop,
  getClaudeSessions,
}: Props) {
  const [viewMode, setViewMode] = useState<"list" | "diagram" | "insights">("list");
  const [filterPreset, setFilterPreset] = useState<SessionLinkFilterPreset>("all");
  const [jsonlLines, setJsonlLines] = useState<string[] | null>(null);
  const [jsonlLoading, setJsonlLoading] = useState(false);
  const [jsonlError, setJsonlError] = useState<string | null>(null);
  const [headerCopied, setHeaderCopied] = useState(false);
  const headerCopyResetTimerRef = useRef<number | null>(null);
  const [turnDiagramTurn, setTurnDiagramTurn] = useState<number | null>(null);
  /** null = 默认展开最后一轮；[] = 用户已收起全部；非空 = 用户所选轮次 */
  const [activeTurnKeys, setActiveTurnKeys] = useState<string[] | null>(null);
  const [turnRange, setTurnRange] = useState<TurnRange | null>(null);
  const [proxySnap, setProxySnap] = useState(getClaudeLlmProxyStoreSnapshot);

  const messages = session?.messages ?? [];
  const repositoryPath = session?.repositoryPath?.trim() ?? "";
  const claudeSessionId = session?.claudeSessionId?.trim() ?? "";
  const canLoadDisk = Boolean(repositoryPath && claudeSessionId);
  const sessionId = session?.id?.trim() ?? "";

  const feedbackLoopSetting = useSessionFeedbackLoopSetting();
  const storedLoopPhase = useMemo((): FeedbackLoopPhase => {
    if (!sessionId) return "idle";
    return loadSessionFeedbackLoopState(sessionId)?.phase ?? "idle";
  }, [sessionId]);
  const [trackedLoopPhase, setTrackedLoopPhase] = useState<FeedbackLoopPhase>(storedLoopPhase);

  useEffect(() => {
    setTrackedLoopPhase(storedLoopPhase);
  }, [sessionId, storedLoopPhase]);

  const linkDataActive = shouldTrackSessionLinkForFeedbackLoop({
    drawerOpen: open,
    feedbackLoopEnabled: feedbackLoopSetting.enabled,
    autoStart: feedbackLoopSetting.autoStart,
    loopPhase: trackedLoopPhase,
  });

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
    if (open) {
      setViewMode(initialViewMode);
      return;
    }
    setViewMode("list");
    setFilterPreset("all");
    setActiveTurnKeys(null);
    setTurnRange(null);
  }, [open, initialViewMode]);

  useEffect(() => {
    if (!linkDataActive) return;
    setJsonlLines(null);
    setJsonlError(null);
    if (!canLoadDisk) return;
    const tailLines =
      session?.diskTranscriptPartial || messages.length < 80 ? JSONL_TAIL_FULL : JSONL_TAIL_LIGHT;
    let cancelled = false;
    setJsonlLoading(true);
    void loadClaudeSessionJsonl(repositoryPath, claudeSessionId, { tailLines })
      .then((lines) => {
        if (!cancelled) setJsonlLines(lines);
      })
      .catch((e: unknown) => {
        if (!cancelled) setJsonlError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setJsonlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkDataActive, canLoadDisk, repositoryPath, claudeSessionId, session?.diskTranscriptPartial, messages.length]);

  const traceSinceMs = session?.createdAt ? session.createdAt - 60_000 : undefined;
  const { fccAligned, traces: fccTraces, loading: fccLoading } = useFccSessionTraces({
    open: linkDataActive,
    sessionHint: claudeSessionId || undefined,
    sinceMs: traceSinceMs,
  });
  const {
    proxyAligned: opencodeAligned,
    traces: opencodeGoTraces,
    loading: opencodeLoading,
  } = useOpencodeGoSessionTraces({
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
    [
      messages,
      jsonlLines,
      llmProxyRecords,
      fccAligned,
      fccTraces,
      opencodeAligned,
      opencodeGoTraces,
    ],
  );

  const linkRecords = linkPipeline.records;
  const events = linkPipeline.events;

  const { stats, turnMetrics } = useMemo(
    () => aggregateSessionLinkRecords(linkRecords),
    [linkRecords],
  );

  const jsonlUsageLines = useMemo(
    () => filterJsonlLinesForUsageScan(jsonlLines),
    [jsonlLines],
  );

  const filteredRecords = useMemo(
    () => filterSessionLinkRecords(linkRecords, filterPreset),
    [linkRecords, filterPreset],
  );

  // ── 轮次区间过滤（仅作用于 diagram / insights 视图） ──────────────────────────
  const diagramEvents = useMemo(
    () =>
      turnRange == null
        ? events
        : filterSequenceEventsForTurnRange(events, turnRange.fromTurn, turnRange.toTurn),
    [events, turnRange],
  );

  const insightsLinkRecords = useMemo(
    () => filterSessionLinkRecordsByTurnRange(linkRecords, turnRange),
    [linkRecords, turnRange],
  );

  const insightsTurnMetrics = useMemo(
    () => filterTurnMetricsByTurnRange(turnMetrics, turnRange),
    [turnMetrics, turnRange],
  );

  const insightsTimestampRange = useMemo(
    () => deriveTimestampRangeFromTurnMetrics(turnMetrics, turnRange),
    [turnMetrics, turnRange],
  );

  const filterByTimestampRange = useCallback(
    <T extends { timestampMs: number }>(rows: readonly T[] | undefined): readonly T[] | undefined => {
      if (!rows) return rows;
      if (!insightsTimestampRange) return rows;
      const { startMs, endMs } = insightsTimestampRange;
      return rows.filter((r) => r.timestampMs >= startMs && r.timestampMs <= endMs);
    },
    [insightsTimestampRange],
  );

  const insightsLlmProxyRecords = useMemo(
    () => filterByTimestampRange(llmProxyRecords) ?? llmProxyRecords,
    [llmProxyRecords, filterByTimestampRange],
  );

  const insightsFccTraces = useMemo(() => {
    if (!fccAligned) return undefined;
    if (!insightsTimestampRange) return fccTraces;
    return fccTraces.filter(
      (t) =>
        t.timestampMs >= insightsTimestampRange.startMs &&
        t.timestampMs <= insightsTimestampRange.endMs,
    );
  }, [fccAligned, fccTraces, insightsTimestampRange]);

  const insightsOpencodeGoTraces = useMemo(() => {
    if (!opencodeAligned) return undefined;
    if (!insightsTimestampRange) return opencodeGoTraces;
    return opencodeGoTraces.filter(
      (t) =>
        t.timestampMs >= insightsTimestampRange.startMs &&
        t.timestampMs <= insightsTimestampRange.endMs,
    );
  }, [opencodeAligned, opencodeGoTraces, insightsTimestampRange]);

  const insightsJsonlUsageLines = useMemo(() => {
    if (!insightsTimestampRange) return jsonlUsageLines;
    const { startMs, endMs } = insightsTimestampRange;
    return jsonlUsageLines.filter((line) => {
      const parsed = parseJsonlUsageRow(line);
      const ts = parsed?.timestampMs;
      if (ts == null) return false;
      return ts >= startMs && ts <= endMs;
    });
  }, [jsonlUsageLines, insightsTimestampRange]);

  const loopInsights = useMemo(() => {
    if (!linkDataActive) return null;
    return computeSessionInsights({
      linkRecords,
      turnMetrics,
      llmProxyRecords,
      fccTraces: fccAligned ? fccTraces : undefined,
      opencodeGoProxyTraces: opencodeAligned ? opencodeGoTraces : undefined,
      jsonlUsageLines,
      llmProxyListening: proxySnap.status?.listening ?? false,
    });
  }, [
    linkDataActive,
    linkRecords,
    turnMetrics,
    llmProxyRecords,
    fccAligned,
    fccTraces,
    opencodeAligned,
    opencodeGoTraces,
    jsonlUsageLines,
    proxySnap.status?.listening,
  ]);

  const displayInsights = useMemo(() => {
    if (!open || viewMode !== "insights") return null;
    return computeSessionInsights({
      linkRecords: insightsLinkRecords,
      turnMetrics: insightsTurnMetrics,
      llmProxyRecords: insightsLlmProxyRecords,
      fccTraces: insightsFccTraces,
      opencodeGoProxyTraces: insightsOpencodeGoTraces,
      jsonlUsageLines: insightsJsonlUsageLines,
      llmProxyListening: proxySnap.status?.listening ?? false,
    });
  }, [
    open,
    viewMode,
    insightsLinkRecords,
    insightsTurnMetrics,
    insightsLlmProxyRecords,
    insightsFccTraces,
    insightsOpencodeGoTraces,
    insightsJsonlUsageLines,
    proxySnap.status?.listening,
  ]);

  const buildExportBundle = useCallback(
    (records: readonly SessionLinkRecord[]) => {
      if (!session) return null;
      return buildSessionLinkExportBundle({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        llmProxyRecords,
        fccTraces: fccAligned ? fccTraces : undefined,
        opencodeGoProxyTraces: opencodeAligned ? opencodeGoTraces : undefined,
        wiseTabSessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        repositoryPath: session.repositoryPath,
        records,
      });
    },
    [
      session,
      messages,
      jsonlLines,
      llmProxyRecords,
      fccAligned,
      fccTraces,
      opencodeAligned,
      opencodeGoTraces,
    ],
  );

  const exportBundle = useMemo(
    () => buildExportBundle(filteredRecords),
    [buildExportBundle, filteredRecords],
  );

  const resolveLinkMetaBundle = useCallback(() => {
    const bundle = buildExportBundle(linkRecords);
    return bundle ? stripSessionLinkDetailsForMetadataExport(bundle) : null;
  }, [buildExportBundle, linkRecords]);

  const handleInsightsAiAnalysis = useCallback(
    async (prompt: string) => {
      if (!onRequestAiAnalysis) return;
      onClose();
      await onRequestAiAnalysis(prompt);
    },
    [onClose, onRequestAiAnalysis],
  );

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
    sessionId: session?.id ?? "",
    enabled: feedbackLoopSetting.enabled,
    maxCycles: feedbackLoopSetting.maxCycles,
    autoStart: feedbackLoopSetting.autoStart,
    earlyStopConvergence: feedbackLoopSetting.earlyStopConvergence,
    autoSaveHabitsToComposer: feedbackLoopSetting.autoSaveHabitsToComposer,
    optimizeConfigArtifacts: feedbackLoopSetting.optimizeConfigArtifacts,
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

  useSessionFeedbackLoopDispatchCompletion({
    anchorSessionId: session?.id ?? "",
    getSessions: getClaudeSessions ?? (() => []),
    onComplete: (record, responseText) => {
      if (record.kind === "optimization" && record.cycleIndex != null) {
        ingestCycleWorkerRef.current(record.cycleIndex, responseText);
      }
      if (record.kind === "config_patch" || record.kind === "optimization") {
        const count = ingestConfigPatchRef.current(responseText);
        if (count > 0) {
          message.success(`神经网 worker 已解析 ${count} 条配置补丁，可在下方审阅`);
        }
      }
    },
  });

  const turnDiagramEvents = useMemo(() => {
    if (turnDiagramTurn == null) return [];
    return filterSequenceEventsForTurn(events, turnDiagramTurn);
  }, [events, turnDiagramTurn]);

  const handleJumpTurnFromInsights = useCallback((turn: number) => {
    setViewMode("list");
    setFilterPreset("all");
    setActiveTurnKeys([String(turn)]);
    setTurnRange(null);
  }, []);

  const openTurnDiagram = useCallback((turn: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setTurnDiagramTurn(turn);
  }, []);

  const runExport = useCallback(
    async (metadataOnly: boolean) => {
      if (!exportBundle || !session) return;
      const bundle = metadataOnly
        ? stripSessionLinkDetailsForMetadataExport(exportBundle)
        : exportBundle;
      const text = serializeSessionLinkExportBundle(bundle);
      const sid = session.claudeSessionId?.slice(0, 8) ?? session.id.slice(0, 8);
      const defaultName = `session-link-${sid}-${Date.now()}${metadataOnly ? "-meta" : ""}.json`;
      try {
        const path = await save({
          defaultPath: defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!path) return;
        await writeTextFileAbsolute(path, text);
      } catch (e) {
        message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [exportBundle, session],
  );

  useEffect(
    () => () => {
      if (headerCopyResetTimerRef.current != null) {
        window.clearTimeout(headerCopyResetTimerRef.current);
      }
    },
    [],
  );

  const handleCopyExport = useCallback(async () => {
    if (!exportBundle) return;
    const text = serializeSessionLinkExportBundle(exportBundle);
    try {
      await navigator.clipboard.writeText(text);
      setHeaderCopied(true);
      if (headerCopyResetTimerRef.current != null) {
        window.clearTimeout(headerCopyResetTimerRef.current);
      }
      headerCopyResetTimerRef.current = window.setTimeout(() => {
        headerCopyResetTimerRef.current = null;
        setHeaderCopied(false);
      }, 2000);
    } catch {
      message.error("复制失败");
    }
  }, [exportBundle]);

  const exportMenuItems = useMemo(
    () => [
      { key: "full", label: "完整导出（含 detail）", onClick: () => void runExport(false) },
      { key: "meta", label: "仅元数据（无 detail）", onClick: () => void runExport(true) },
    ],
    [runExport],
  );

  const collapseItems = useMemo(() => {
    const byTurn = new Map<number, SessionLinkRecord[]>();
    for (const r of filteredRecords) {
      const list = byTurn.get(r.turnIndex) ?? [];
      list.push(r);
      byTurn.set(r.turnIndex, list);
    }
    return [...byTurn.entries()]
      .sort(([a], [b]) => a - b)
      .map(([turn, recs]) => {
        const metric = turnMetrics.find((m) => m.turnIndex === turn);
        return {
          key: String(turn),
          label: (
            <span className="app-session-data-link__turn-label">
              轮次 {turn}
              {metric ? (
                <Text type="secondary" className="app-session-data-link__turn-meta">
                  {formatDuration(metric.durationMs)} · {recs.length} 条
                  {metric.httpObserved > 0 ? ` · HTTP ${metric.httpObserved}` : ""}
                </Text>
              ) : (
                <Text type="secondary" className="app-session-data-link__turn-meta">
                  {recs.length} 条
                </Text>
              )}
            </span>
          ),
          extra: (
            <Button
              type="link"
              size="small"
              className="app-session-data-link__turn-diagram-btn"
              onClick={(e) => openTurnDiagram(turn, e)}
            >
              时序图
            </Button>
          ),
          children: (
            <ul className="app-session-data-link__record-list">
              {recs.map((r) => (
                <RecordItem key={r.id} record={r} />
              ))}
            </ul>
          ),
        };
      });
  }, [filteredRecords, turnMetrics, openTurnDiagram]);

  const resolvedActiveTurnKeys = useMemo(() => {
    if (activeTurnKeys !== null) return activeTurnKeys;
    if (collapseItems.length === 0) return [];
    return [collapseItems[collapseItems.length - 1]!.key];
  }, [activeTurnKeys, collapseItems]);

  const diskStatusLine = useMemo(() => {
    if (!canLoadDisk) return null;
    if (jsonlLoading) return "JSONL 合并中…";
    if (jsonlError) return `JSONL 失败：${jsonlError}`;
    if (jsonlLines) return `JSONL ${jsonlLines.length} 行`;
    return null;
  }, [canLoadDisk, jsonlLoading, jsonlError, jsonlLines]);

  const showFccHint =
    fccAligned &&
    !opencodeAligned &&
    stats.httpInferred > 0 &&
    stats.httpObserved === 0 &&
    fccTraces.length === 0 &&
    !fccLoading;

  const showOpencodeHint =
    opencodeAligned &&
    stats.httpInferred > 0 &&
    stats.httpObserved === 0 &&
    opencodeGoTraces.length === 0 &&
    !opencodeLoading;

  return (
    <Drawer
      rootClassName="app-session-link-drawer-root"
      title={
        session ? (
          <div className="app-session-link-drawer__title">
            <span className="title-dot" />
            <span className="title-text">全链路分析</span>
            <span className="title-divider">·</span>
            <span className="title-session-label">主会话</span>
            <span className="title-session-name">({session.repositoryName.trim() || "未命名"})</span>
          </div>
        ) : (
          "全链路分析"
        )
      }
      placement="right"
      size={880}
      destroyOnClose
      open={open}
      onClose={onClose}
      extra={
        <Space size={8} wrap>
          <Button
            size="small"
            className={`app-session-link-header-btn app-session-link-header-btn--copy ${headerCopied ? "copied" : ""}`}
            icon={headerCopied ? <CheckOutlined style={{ color: "#10b981" }} /> : <CopyOutlined />}
            disabled={!exportBundle}
            onClick={() => void handleCopyExport()}
          >
            {headerCopied ? "已复制" : "复制 JSON"}
          </Button>
          <Dropdown menu={{ items: exportMenuItems }} disabled={!exportBundle}>
            <Button
              size="small"
              type="primary"
              className="app-session-link-header-btn app-session-link-header-btn--export"
              icon={<DownloadOutlined />}
              disabled={!exportBundle}
            >
              导出
            </Button>
          </Dropdown>
        </Space>
      }
      styles={{ body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" } }}
    >
      <div className="app-session-data-link">
        {!session ? (
          <Empty className="app-session-data-link__empty" description="请先打开一个会话" />
        ) : (
          <>
            <div className="app-session-data-link__toolbar">
              <div className="app-session-data-link__toolbar-left">
                <Segmented
                  size="small"
                  value={viewMode}
                  onChange={(v) => setViewMode(v as "list" | "diagram" | "insights")}
                  options={[
                    { label: "链路列表", value: "list" },
                    { label: "序列图", value: "diagram" },
                    { label: "洞察", value: "insights" },
                  ]}
                />
                {viewMode === "list" ? (
                  <Select
                    size="small"
                    className="app-session-data-link__filter"
                    value={filterPreset}
                    onChange={setFilterPreset}
                    options={SESSION_LINK_FILTER_OPTIONS}
                    aria-label="链路过滤"
                  />
                ) : (
                  <TurnRangeFilter
                    turnMetrics={turnMetrics}
                    value={turnRange}
                    onChange={setTurnRange}
                  />
                )}
              </div>

              <div className="app-session-data-link__stats-bar">
              <div className="app-session-data-link__stat-item">
                <ClockCircleOutlined className="stat-icon stat-icon--turns" />
                <span className="stat-label">轮次</span>
                <span className="stat-num">{stats.turns}</span>
              </div>
              <div className="app-session-data-link__stat-divider" />
              <div className="app-session-data-link__stat-item">
                <ToolOutlined className="stat-icon stat-icon--tools" />
                <span className="stat-label">工具</span>
                <span className="stat-num">{stats.tools}</span>
              </div>
              <div className="app-session-data-link__stat-divider" />
              <div className="app-session-data-link__stat-item">
                <GlobalOutlined className="stat-icon stat-icon--http" />
                <span className="stat-label">HTTP/推断</span>
                <span className="stat-num">
                  {stats.httpObserved}
                  {stats.httpInferred > 0 ? <span className="stat-num-sub">/{stats.httpInferred}</span> : null}
                </span>
              </div>
              {llmProxyRecords.length > 0 ? (
                <>
                  <div className="app-session-data-link__stat-divider" />
                  <div className="app-session-data-link__stat-item">
                    <ApiOutlined className="stat-icon stat-icon--proxy" />
                    <span className="stat-label">代理</span>
                    <span className="stat-num">{llmProxyRecords.length}</span>
                  </div>
                </>
              ) : null}
              {opencodeAligned && (opencodeGoTraces.length > 0 || opencodeLoading) ? (
                <>
                  <div className="app-session-data-link__stat-divider" />
                  <div className="app-session-data-link__stat-item">
                    <ApiOutlined className="stat-icon stat-icon--proxy" />
                    <span className="stat-label">OpenCode</span>
                    <span className="stat-num">
                      {opencodeLoading ? "..." : opencodeGoTraces.length}
                    </span>
                  </div>
                </>
              ) : null}
              {fccAligned && (fccTraces.length > 0 || fccLoading) ? (
                <>
                  <div className="app-session-data-link__stat-divider" />
                  <div className="app-session-data-link__stat-item">
                    <DatabaseOutlined className="stat-icon stat-icon--fcc" />
                    <span className="stat-label">FCC</span>
                    <span className="stat-num">{fccLoading ? "..." : fccTraces.length}</span>
                  </div>
                </>
              ) : null}
              {diskStatusLine ? (
                <>
                  <div className="app-session-data-link__stat-divider" />
                  <div className="app-session-data-link__stat-item">
                    <DatabaseOutlined className="stat-icon stat-icon--disk" />
                    <span className="stat-label">JSONL行</span>
                    <span className="stat-num">{jsonlLines ? jsonlLines.length : "..."}</span>
                  </div>
                </>
              ) : null}
              </div>
            </div>

            {showOpencodeHint ? (
              <Alert
                className="app-session-data-link__alert app-session-data-link__alert--compact"
                type="info"
                showIcon
                message={
                  <span className="app-session-data-link__alert-line">
                    <span className="app-session-data-link__alert-title">OpenCode Go 代理：HTTP 未观测</span>
                    <span className="app-session-data-link__alert-detail">
                      确认代理已运行且会话内有模型请求；顶栏 OpenCode「流量」Tab 可看 trace。
                    </span>
                  </span>
                }
              />
            ) : null}
            {showFccHint ? (
              <Alert
                className="app-session-data-link__alert app-session-data-link__alert--compact"
                type="info"
                showIcon
                message={
                  <span className="app-session-data-link__alert-line">
                    <span className="app-session-data-link__alert-title">FCC 直连：HTTP 未观测</span>
                    <span className="app-session-data-link__alert-detail">
                      开启 FCC 后查看 server.log trace，或临时用 LLM 代理中转。
                    </span>
                  </span>
                }
              />
            ) : null}

            {session.diskTranscriptPartial && canLoadDisk ? (
              <Alert
                className="app-session-data-link__alert"
                type="warning"
                showIcon
                message="磁盘消息可能仅为尾部子集"
              />
            ) : null}

            {!canLoadDisk ? (
              <div className="app-session-data-link__stats-fallback">
                <Text type="secondary">无会话 ID，仅内存消息</Text>
              </div>
            ) : null}

            <div className="app-session-data-link__body">
              {viewMode === "insights" ? (
                displayInsights ? (
                  <SessionInsightsPanel
                    insights={displayInsights}
                    sessionLabel={session.repositoryName.trim() || undefined}
                    claudeSessionId={session.claudeSessionId}
                    resolveLinkMetaBundle={resolveLinkMetaBundle}
                    repositoryPath={session.repositoryPath}
                    onJumpTurn={handleJumpTurnFromInsights}
                    onRequestAiAnalysis={onRequestAiAnalysis ? handleInsightsAiAnalysis : undefined}
                    onDispatchSessionFeedbackLoop={
                      onDispatchSessionFeedbackLoop ? dispatchFeedbackLoopPrompt : undefined
                    }
                    feedbackLoop={feedbackLoop}
                    feedbackLoopFeatureEnabled={feedbackLoopSetting.enabled}
                    feedbackLoopInjectSystemPrompt={feedbackLoopSetting.injectHabitsToSystemPrompt}
                    feedbackLoopOptimizeConfigArtifacts={
                      feedbackLoopSetting.optimizeConfigArtifacts
                    }
                    feedbackLoopAnchorSessionId={session.id}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在计算洞察…" />
                )
              ) : viewMode === "list" ? (
                filteredRecords.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无链路记录" />
                ) : (
                  <Collapse
                    size="small"
                    className="app-session-data-link__collapse"
                    items={collapseItems}
                    activeKey={resolvedActiveTurnKeys}
                    onChange={(keys) => setActiveTurnKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                  />
                )
              ) : events.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无序列事件" />
              ) : diagramEvents.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="所选轮次无序列事件"
                />
              ) : (
                <ClaudeSessionSequenceDiagram events={diagramEvents} markInferredHttp />
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        title={turnDiagramTurn != null ? `轮次 ${turnDiagramTurn} · 时序图` : "时序图"}
        open={turnDiagramTurn != null}
        onCancel={() => setTurnDiagramTurn(null)}
        footer={null}
        width={920}
        destroyOnClose
        className="app-session-data-link-turn-diagram-modal"
        styles={{ body: { padding: 0 } }}
      >
        {turnDiagramEvents.length === 0 ? (
          <Empty
            className="app-session-data-link-turn-diagram-modal__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该轮次暂无序列事件"
          />
        ) : (
          <ClaudeSessionSequenceDiagram events={turnDiagramEvents} markInferredHttp />
        )}
      </Modal>
    </Drawer>
  );
}

interface TurnRangeFilterProps {
  turnMetrics: readonly { turnIndex: number }[];
  value: TurnRange | null;
  onChange: (next: TurnRange | null) => void;
}

const TURN_RANGE_CUSTOM_VALUE = "__range";
const TURN_RANGE_ALL_VALUE = "__all";

function TurnRangeFilter({ turnMetrics, value, onChange }: TurnRangeFilterProps) {
  const totalTurns = turnMetrics.length;
  const sortedTurns = useMemo(
    () => [...turnMetrics].map((m) => m.turnIndex).sort((a, b) => a - b),
    [turnMetrics],
  );
  const minTurn = sortedTurns[0] ?? 1;
  const maxTurn = sortedTurns[sortedTurns.length - 1] ?? minTurn;

  const customMode = value != null && value.fromTurn !== value.toTurn;

  const presetValue = value == null
    ? TURN_RANGE_ALL_VALUE
    : customMode
      ? TURN_RANGE_CUSTOM_VALUE
      : `:${value.fromTurn}`;

  const presetOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [
      { label: `全部（${totalTurns} 轮）`, value: TURN_RANGE_ALL_VALUE },
    ];
    for (const turn of sortedTurns) {
      opts.push({ label: `第 ${turn} 轮`, value: `:${turn}` });
    }
    opts.push({ label: "自定义区间…", value: TURN_RANGE_CUSTOM_VALUE });
    return opts;
  }, [sortedTurns, totalTurns]);

  const turnOptions = useMemo(
    () => sortedTurns.map((t) => ({ label: `第 ${t} 轮`, value: t })),
    [sortedTurns],
  );

  const handlePresetChange = useCallback(
    (raw: string) => {
      if (raw === TURN_RANGE_ALL_VALUE) {
        onChange(null);
        return;
      }
      if (raw === TURN_RANGE_CUSTOM_VALUE) {
        // 进入自定义模式：默认覆盖最小到最大
        if (sortedTurns.length === 0) {
          onChange(null);
          return;
        }
        if (sortedTurns.length === 1) {
          onChange({ fromTurn: minTurn, toTurn: maxTurn });
          return;
        }
        // 默认 [min, max] 表示「全部，但用户可调」
        onChange({ fromTurn: minTurn, toTurn: maxTurn });
        return;
      }
      const turn = Number(raw.slice(1));
      if (!Number.isFinite(turn) || turn < 1) {
        onChange(null);
        return;
      }
      onChange({ fromTurn: turn, toTurn: turn });
    },
    [onChange, sortedTurns.length, minTurn, maxTurn],
  );

  const handleFromChange = useCallback(
    (next: number) => {
      const current = value ?? { fromTurn: minTurn, toTurn: maxTurn };
      const from = next;
      const to = Math.max(from, current.toTurn);
      onChange({ fromTurn: from, toTurn: to });
    },
    [onChange, value, minTurn, maxTurn],
  );

  const handleToChange = useCallback(
    (next: number) => {
      const current = value ?? { fromTurn: minTurn, toTurn: maxTurn };
      const to = next;
      const from = Math.min(current.fromTurn, to);
      onChange({ fromTurn: from, toTurn: to });
    },
    [onChange, value, minTurn, maxTurn],
  );

  if (totalTurns === 0) {
    return null;
  }

  return (
    <Space size={4} wrap>
      <Select
        size="small"
        className="app-session-data-link__filter"
        style={{ minWidth: 140 }}
        value={presetValue}
        onChange={handlePresetChange}
        options={presetOptions}
        aria-label="轮次过滤"
      />
      {customMode ? (
        <>
          <Select
            size="small"
            style={{ minWidth: 96 }}
            value={value?.fromTurn ?? minTurn}
            onChange={handleFromChange}
            options={turnOptions}
            aria-label="起始轮次"
          />
          <span style={{ color: "var(--ant-color-text-tertiary, rgba(0,0,0,0.45))" }}>~</span>
          <Select
            size="small"
            style={{ minWidth: 96 }}
            value={value?.toTurn ?? maxTurn}
            onChange={handleToChange}
            options={turnOptions}
            aria-label="结束轮次"
          />
          <Button size="small" type="text" onClick={() => onChange(null)}>
            清除
          </Button>
        </>
      ) : null}
    </Space>
  );
}
