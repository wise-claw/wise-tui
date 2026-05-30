import { useEffect, useMemo, useRef, useState } from "react";
import { writeProjectRelativeFile } from "../../services/materializePrdSnapshot";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";
import {
  contextPercentToneClassName,
  estimateContextPercent,
  estimateMessageTokens,
  estimateSessionTokens,
  formatContextStatusHint,
  getContextPercentTone,
} from "../../services/claudeSessionContext";
import type { ClaudeSession } from "../../types";

interface ClaudeStatusPanelProps {
  repositoryPath: string;
  session: ClaudeSession;
}

interface StatusSnapshot {
  line?: string;
  plugin?: string;
  session?: string;
  ctx?: string;
  ctxPercent?: number;
  estimatedTokens?: number;
  source?: string;
  timestamp?: number;
  raw?: unknown;
}

interface TokenMetrics {
  estimatedTokens: number;
  ctxPercent: number;
}

interface SnapshotSource {
  id: string;
  claudeSessionId: string | null;
  repositoryPath: string;
  model: string;
  status: ClaudeSession["status"];
  createdAt: number;
  messageCount: number;
}

const PANEL_REFRESH_MS = 2000;
const FILE_PERSIST_MIN_INTERVAL_MS = 10_000;
const PANEL_IDLE_REFRESH_MS = 60_000;
const FILE_IDLE_PERSIST_MIN_INTERVAL_MS = 30_000;

function persistStatusFile(repositoryPath: string, snapshot: StatusSnapshot): Promise<void> {
  return writeProjectRelativeFile(repositoryPath, ".claude/status-panel.json", JSON.stringify(snapshot, null, 2))
    .then(() => undefined)
    .catch(() => undefined);
}

function formatSessionDuration(createdAt: number): string {
  const diff = Math.max(0, Date.now() - createdAt);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function mapSessionStatus(status: ClaudeSession["status"]): string {
  if (status === "running") return "运行中";
  if (status === "connecting") return "连接中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "error") return "异常";
  return "空闲";
}

function buildAutoSnapshot(source: SnapshotSource, metrics: TokenMetrics): StatusSnapshot {
  const plugin = source.model?.trim() || "Claude";
  const sessionText = formatSessionDuration(source.createdAt);
  const hint = formatContextStatusHint(metrics);
  const ctx = hint
    ? `${metrics.ctxPercent}% (~${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens, ${hint})`
    : `${metrics.ctxPercent}% (~${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens)`;
  const state = mapSessionStatus(source.status);
  return {
    source: "wise-auto-status-panel",
    plugin,
    session: sessionText,
    ctx,
    ctxPercent: metrics.ctxPercent,
    estimatedTokens: metrics.estimatedTokens,
    line: `[${plugin}] | session:${sessionText} | ctx:${ctx} | status:${state}`,
    timestamp: Date.now(),
    raw: {
      sessionId: source.claudeSessionId ?? source.id,
      status: source.status,
      messageCount: source.messageCount,
      estimatedTokens: metrics.estimatedTokens,
      ctxPercent: metrics.ctxPercent,
      repositoryPath: source.repositoryPath,
    },
  };
}

export function ClaudeStatusPanel({ repositoryPath, session }: ClaudeStatusPanelProps) {
  const messageSignature = useMemo(() => {
    const last = session.messages[session.messages.length - 1];
    return `${session.messages.length}:${last?.id ?? ""}:${last?.timestamp ?? 0}:${last?.content.length ?? 0}:${last?.parts.length ?? 0}`;
  }, [session.messages]);
  const [metrics, setMetrics] = useState<TokenMetrics>(() => {
    const estimatedTokens = estimateSessionTokens(session);
    return { estimatedTokens, ctxPercent: estimateContextPercent(estimatedTokens) };
  });
  const tokenCacheRef = useRef<{
    signature: string;
    perMessage: Map<number, number>;
    total: number;
  }>({
    signature: "",
    perMessage: new Map(),
    total: 0,
  });
  const snapshotInput = useMemo(
    () => ({
      id: session.id,
      claudeSessionId: session.claudeSessionId,
      repositoryPath: session.repositoryPath,
      model: session.model,
      status: session.status,
      createdAt: session.createdAt,
      messageCount: session.messages.length,
    }),
    [
      session.id,
      session.claudeSessionId,
      session.repositoryPath,
      session.model,
      session.status,
      session.createdAt,
      session.messages.length,
    ],
  );
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(() => buildAutoSnapshot(snapshotInput, metrics));
  const lastPersistAtRef = useRef(0);
  const lastPersistKeyRef = useRef("");
  const isSessionActive = session.status === "running" || session.status === "connecting";

  useEffect(() => {
    const cache = tokenCacheRef.current;
    let estimatedTokens = 0;
    if (cache.signature === messageSignature) {
      estimatedTokens = cache.total;
    } else {
      const nextPerMessage = new Map<number, number>();
      let nextTotal = 0;
      for (const message of session.messages) {
        const cached = cache.perMessage.get(message.id);
        const token = cached ?? estimateMessageTokens(message);
        nextPerMessage.set(message.id, token);
        nextTotal += token;
      }
      cache.signature = messageSignature;
      cache.perMessage = nextPerMessage;
      cache.total = nextTotal;
      estimatedTokens = nextTotal;
    }
    setMetrics({
      estimatedTokens,
      ctxPercent: estimateContextPercent(estimatedTokens),
    });
  }, [messageSignature, session.messages]);

  useEffect(() => {
    const refresh = () => {
      const next = buildAutoSnapshot(snapshotInput, metrics);
      setSnapshot(next);
      const persistKey = `${snapshotInput.status}|${snapshotInput.model}|${snapshotInput.messageCount}|${metrics.estimatedTokens}|${metrics.ctxPercent}`;
      const now = Date.now();
      const persistInterval = isSessionActive
        ? FILE_PERSIST_MIN_INTERVAL_MS
        : FILE_IDLE_PERSIST_MIN_INTERVAL_MS;
      const shouldPersist =
        persistKey !== lastPersistKeyRef.current || now - lastPersistAtRef.current >= persistInterval;
      if (shouldPersist) {
        lastPersistAtRef.current = now;
        lastPersistKeyRef.current = persistKey;
        void persistStatusFile(repositoryPath, next);
      }
    };

    refresh();
    const timer = window.setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible" &&
        !isSessionActive
      ) {
        return;
      }
      refresh();
    }, readVisiblePollIntervalMs(
      isSessionActive ? PANEL_REFRESH_MS : PANEL_IDLE_REFRESH_MS,
      isSessionActive ? 8000 : 180_000,
    ));

    return () => {
      window.clearInterval(timer);
    };
  }, [repositoryPath, snapshotInput, metrics, isSessionActive]);

  const updatedAtText = useMemo(() => {
    if (!snapshot?.timestamp) return null;
    return new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [snapshot?.timestamp]);

  return (
    <div className="app-claude-status-panel">
      <div className="app-claude-status-panel__head">
        <div className="app-claude-status-panel__title">状态面板</div>
        {updatedAtText ? <div className="app-claude-status-panel__time">更新于 {updatedAtText}</div> : null}
      </div>
      <div className="app-claude-status-panel__row">
        <span className="app-claude-status-panel__tag">状态</span>
        <span className="app-claude-status-panel__value">{mapSessionStatus(session.status)}</span>
      </div>
      <div className="app-claude-status-panel__row">
        <span className="app-claude-status-panel__tag">插件</span>
        <span className="app-claude-status-panel__value">{snapshot.plugin ?? "-"}</span>
      </div>
      <div className="app-claude-status-panel__row">
        <span className="app-claude-status-panel__tag">会话</span>
        <span className="app-claude-status-panel__value">{snapshot.session ?? "-"}</span>
      </div>
      <div className="app-claude-status-panel__row">
        <span className="app-claude-status-panel__tag">上下文</span>
        <span
          className={`app-claude-status-panel__value ${contextPercentToneClassName(getContextPercentTone(metrics.ctxPercent))}`}
        >
          {snapshot.ctx ?? "-"}
        </span>
      </div>
    </div>
  );
}
