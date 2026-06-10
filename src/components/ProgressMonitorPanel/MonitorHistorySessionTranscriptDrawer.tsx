import { Button, Drawer, Empty, Space, Tag, message } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession } from "../../types";
import { useClaudeSessionsLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  HistorySessionDrawerContextBar,
  HistorySessionDrawerTitle,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";
import { HistorySessionRestoreButton } from "./HistorySessionRestoreButton";
import {
  MonitorDrawerSessionComposer,
  type MonitorDrawerResumeSessionFn,
} from "./MonitorDrawerSessionComposer";
import { latestTerminalTurnHasAssistant } from "../../hooks/useClaudeSessions.transcript";
import { isTerminalWorkerWiseTab } from "../../services/terminalDispatch";

export interface MonitorHistorySessionTranscriptDrawerProps {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  /** @deprecated App 壳层不再随流式重渲染；组件内读 live store。 */
  transcriptSourceSessions?: ClaudeSession[];
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onCancelSession?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
  canRestoreSession?: (sessionId: string) => boolean;
  /** 抽屉底部输入：对当前会话 resume 继续执行 */
  onResumeSession?: MonitorDrawerResumeSessionFn;
}

function cloneSessionForDrawerSnapshot(session: ClaudeSession): ClaudeSession {
  return {
    ...session,
    messages: session.messages.map((msg) => ({
      ...msg,
      parts: msg.parts?.map((part) => ({ ...part })),
    })),
  };
}

function resolveLiveSession(
  sessionId: string | null,
  transcriptSourceSessions: ClaudeSession[],
): ClaudeSession | undefined {
  if (!sessionId) return undefined;
  return transcriptSourceSessions.find(
    (item) => item.id === sessionId || item.claudeSessionId === sessionId,
  );
}

export function MonitorHistorySessionTranscriptDrawer({
  open,
  sessionId,
  onClose,
  transcriptSourceSessions: _transcriptSourceSessionsProp,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  onCancelSession,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  onRestoreSession,
  canRestoreSession,
  onResumeSession,
}: MonitorHistorySessionTranscriptDrawerProps) {
  const transcriptSourceSessions = useClaudeSessionsLiveSnapshot(open);
  const [compactInFlight, setCompactInFlight] = useState(false);
  const [drawerSessionSnapshot, setDrawerSessionSnapshot] = useState<ClaudeSession | null>(null);
  const openedSessionIdRef = useRef<string | null>(null);
  const diskReloadAttemptedRef = useRef<string | null>(null);
  const diskReloadRetryTimersRef = useRef<number[]>([]);

  const drawerWidth = useMemo(
    () => Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560),
    [],
  );

  const liveSession = useMemo(
    () => resolveLiveSession(sessionId, transcriptSourceSessions),
    [sessionId, transcriptSourceSessions],
  );

  const syncDrawerSnapshotFromLive = useCallback((session: ClaudeSession) => {
    setDrawerSessionSnapshot((prev) => {
      const next = cloneSessionForDrawerSnapshot(session);
      if (!prev || prev.id !== next.id) return next;
      const prevHasAssistant = latestTerminalTurnHasAssistant(prev.messages);
      const nextHasAssistant = latestTerminalTurnHasAssistant(next.messages);
      if (prevHasAssistant && !nextHasAssistant) return prev;
      if (prev.messages.length > next.messages.length && prevHasAssistant) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || !sessionId) {
      openedSessionIdRef.current = null;
      diskReloadAttemptedRef.current = null;
      setDrawerSessionSnapshot(null);
      return;
    }
    if (openedSessionIdRef.current === sessionId) {
      return;
    }
    openedSessionIdRef.current = sessionId;
    diskReloadAttemptedRef.current = null;
    const found = resolveLiveSession(sessionId, transcriptSourceSessions);
    setDrawerSessionSnapshot(found ? cloneSessionForDrawerSnapshot(found) : null);
  }, [open, sessionId, transcriptSourceSessions]);

  useEffect(() => {
    if (!open || !sessionId || !liveSession) return;
    syncDrawerSnapshotFromLive(liveSession);
  }, [open, sessionId, liveSession, syncDrawerSnapshotFromLive]);

  const peekTranscriptTargetId = liveSession?.id ?? null;
  const peekTranscriptStatus = liveSession?.status;
  const peekTranscriptClaudeId = liveSession?.claudeSessionId?.trim() ?? "";
  const peekNeedsFullTranscript = !liveSession?.transcriptMemoryUnlimited;

  const missingTerminalAssistant =
    liveSession != null &&
    isTerminalWorkerWiseTab(liveSession) &&
    (liveSession.status === "completed" || liveSession.status === "running") &&
    !latestTerminalTurnHasAssistant(liveSession.messages);

  const memoryHasTerminalAssistant =
    liveSession != null &&
    isTerminalWorkerWiseTab(liveSession) &&
    latestTerminalTurnHasAssistant(liveSession.messages);

  useEffect(() => {
    if (!open || !sessionId || !onReloadFullDiskTranscript || !peekTranscriptTargetId) return;
    if (!peekNeedsFullTranscript) return;
    if (!peekTranscriptClaudeId) return;
    // 内存已有助手回复时，终端 jsonl 仅为单轮切片，reload 可能覆盖多轮历史。
    if (memoryHasTerminalAssistant) return;
    if (peekTranscriptStatus === "running" || peekTranscriptStatus === "connecting") {
      if (!missingTerminalAssistant) return;
    }
    const reloadKey = `${sessionId}:${peekTranscriptClaudeId}:${liveSession?.messages.length ?? 0}`;
    if (diskReloadAttemptedRef.current === reloadKey) return;
    diskReloadAttemptedRef.current = reloadKey;

    const runReload = () => {
      void onReloadFullDiskTranscript(peekTranscriptTargetId);
    };
    runReload();

    for (const timerId of diskReloadRetryTimersRef.current) {
      window.clearTimeout(timerId);
    }
    diskReloadRetryTimersRef.current = [];
    if (missingTerminalAssistant) {
      for (const delay of [800, 2000, 4000]) {
        diskReloadRetryTimersRef.current.push(
          window.setTimeout(() => {
            diskReloadAttemptedRef.current = null;
            runReload();
          }, delay),
        );
      }
    }

    return () => {
      for (const timerId of diskReloadRetryTimersRef.current) {
        window.clearTimeout(timerId);
      }
      diskReloadRetryTimersRef.current = [];
    };
  }, [
    open,
    sessionId,
    onReloadFullDiskTranscript,
    peekTranscriptTargetId,
    peekNeedsFullTranscript,
    peekTranscriptStatus,
    peekTranscriptClaudeId,
    missingTerminalAssistant,
    memoryHasTerminalAssistant,
    liveSession?.messages.length,
  ]);

  const displaySession = useMemo(() => {
    if (liveSession) {
      if (!drawerSessionSnapshot || drawerSessionSnapshot.id !== liveSession.id) {
        return liveSession;
      }
      const liveHasAssistant = latestTerminalTurnHasAssistant(liveSession.messages);
      const snapshotHasAssistant = latestTerminalTurnHasAssistant(drawerSessionSnapshot.messages);
      if (!liveHasAssistant && snapshotHasAssistant) return drawerSessionSnapshot;
      if (
        liveSession.messages.length < drawerSessionSnapshot.messages.length &&
        snapshotHasAssistant
      ) {
        return drawerSessionSnapshot;
      }
      return liveSession;
    }
    return drawerSessionSnapshot;
  }, [liveSession, drawerSessionSnapshot]);
  const snapshotFrozen = Boolean(
    liveSession != null &&
      drawerSessionSnapshot != null &&
      displaySession === drawerSessionSnapshot &&
      !latestTerminalTurnHasAssistant(liveSession.messages) &&
      latestTerminalTurnHasAssistant(drawerSessionSnapshot.messages),
  );

  const refreshDrawerSnapshot = useCallback(() => {
    if (!sessionId) return;
    const found = resolveLiveSession(sessionId, transcriptSourceSessions);
    if (!found) {
      message.warning("未找到该会话");
      return;
    }
    if (
      onReloadFullDiskTranscript &&
      found.claudeSessionId?.trim() &&
      !(isTerminalWorkerWiseTab(found) && latestTerminalTurnHasAssistant(found.messages))
    ) {
      diskReloadAttemptedRef.current = null;
      void onReloadFullDiskTranscript(found.id);
      return;
    }
    syncDrawerSnapshotFromLive(found);
  }, [sessionId, transcriptSourceSessions, onReloadFullDiskTranscript, syncDrawerSnapshotFromLive]);

  const canStopLiveSession =
    Boolean(onCancelSession) &&
    liveSession != null &&
    (liveSession.status === "running" || liveSession.status === "connecting");
  const canCompactSession =
    Boolean(onCompactSessionHistory) &&
    liveSession != null &&
    Boolean(liveSession.claudeSessionId?.trim()) &&
    liveSession.status !== "running" &&
    liveSession.status !== "connecting" &&
    !compactInFlight;
  const showRestore =
    Boolean(onRestoreSession) &&
    liveSession != null &&
    (canRestoreSession ? canRestoreSession(liveSession.id) : true);

  function compactSessionHistory() {
    if (!onCompactSessionHistory || !liveSession || !canCompactSession) return;
    setCompactInFlight(true);
    void Promise.resolve(onCompactSessionHistory(liveSession.id))
      .then(() => {
        refreshDrawerSnapshot();
      })
      .catch(() => {
        /* 失败说明已由会话系统消息记录。 */
      })
      .finally(() => {
        setCompactInFlight(false);
      });
  }

  return (
    <Drawer
      title={<HistorySessionDrawerTitle session={displaySession ?? liveSession} />}
      open={open}
      onClose={onClose}
      placement="right"
      destroyOnHidden
      getContainer={() => document.body}
      zIndex={1200}
      size={drawerWidth}
      classNames={{
        header: "app-monitor-panel__history-session-drawer-header",
        body: "app-monitor-panel__history-session-drawer-body",
      }}
      extra={
        liveSession ? (
          <Space size="small" wrap align="center">
            <Tag color={historySessionStatusTagColor(liveSession.status)}>
              {historySessionStatusLabel(liveSession.status)}
            </Tag>
            {snapshotFrozen ? (
              <Tag color="default">已冻结快照</Tag>
            ) : null}
            <HoverHint title="从当前会话状态重新抓取消息列表">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label="刷新消息列表"
                onClick={refreshDrawerSnapshot}
              />
            </HoverHint>
            {showRestore ? (
              <HistorySessionRestoreButton
                onClick={() => {
                  onRestoreSession?.(liveSession.id);
                }}
              />
            ) : null}
            {onCompactSessionHistory ? (
              <Button
                size="small"
                loading={compactInFlight}
                disabled={!canCompactSession}
                onClick={compactSessionHistory}
              >
                压缩
              </Button>
            ) : null}
            {canStopLiveSession && onCancelSession ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  onCancelSession(liveSession.id);
                }}
              >
                结束
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      {!displaySession ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该会话" />
      ) : displaySession.messages.length === 0 &&
        displaySession.status !== "running" &&
        displaySession.status !== "connecting" ? (
        <div className="app-monitor-panel__history-session-drawer-inner">
          <HistorySessionDrawerContextBar session={displaySession} />
          <div className="app-monitor-panel__history-session-drawer-scroll app-monitor-panel__history-session-drawer-scroll--empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                displaySession.claudeSessionId?.trim()
                  ? "该会话暂无消息，可能任务未成功启动或 transcript 尚未落盘"
                  : "暂无消息"
              }
            />
          </div>
          <MonitorDrawerSessionComposer
            session={liveSession ?? displaySession}
            onResumeSession={onResumeSession}
          />
        </div>
      ) : (
        <div className="app-monitor-panel__history-session-drawer-inner">
          <HistorySessionDrawerContextBar session={displaySession} />
          <div className="app-monitor-panel__history-session-drawer-scroll">
            <ClaudeSessionMessagesColumn
              session={displaySession}
              onOpenTaskDetail={onOpenTaskDetail}
              onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
              sessionsForDispatchLookup={transcriptSourceSessions}
              showAllMessages
            />
          </div>
          <MonitorDrawerSessionComposer
            session={liveSession ?? displaySession}
            onResumeSession={onResumeSession}
          />
        </div>
      )}
    </Drawer>
  );
}
