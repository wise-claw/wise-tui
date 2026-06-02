import { Button, Drawer, Empty, Space, Tag, Tooltip, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession } from "../../types";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  HistorySessionDrawerTitle,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";
import { HistorySessionRestoreButton } from "./HistorySessionRestoreButton";

export interface MonitorHistorySessionTranscriptDrawerProps {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  /** 与监控台一致：用于解析抽屉内会话（可与节流列表分离） */
  transcriptSourceSessions: ClaudeSession[];
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onCancelSession?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
  canRestoreSession?: (sessionId: string) => boolean;
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
  transcriptSourceSessions,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  onCancelSession,
  onOpenTaskDetail,
  onRestoreSession,
  canRestoreSession,
}: MonitorHistorySessionTranscriptDrawerProps) {
  const [compactInFlight, setCompactInFlight] = useState(false);
  const [drawerSessionSnapshot, setDrawerSessionSnapshot] = useState<ClaudeSession | null>(null);
  const openedSessionIdRef = useRef<string | null>(null);
  const diskReloadAttemptedRef = useRef<string | null>(null);

  const drawerWidth = useMemo(
    () => Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560),
    [],
  );

  const liveSession = useMemo(
    () => resolveLiveSession(sessionId, transcriptSourceSessions),
    [sessionId, transcriptSourceSessions],
  );

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
    if (liveSession.status !== "running" && liveSession.status !== "connecting") {
      setDrawerSessionSnapshot(null);
      return;
    }
    setDrawerSessionSnapshot((prev) => {
      if (prev?.id === liveSession.id) return prev;
      return cloneSessionForDrawerSnapshot(liveSession);
    });
  }, [open, sessionId, liveSession?.id, liveSession?.status]);

  const peekTranscriptTargetId = liveSession?.id ?? null;
  const peekTranscriptMessagesLen = liveSession?.messages.length ?? 0;
  const peekTranscriptStatus = liveSession?.status;
  const peekTranscriptClaudeId = liveSession?.claudeSessionId?.trim() ?? "";
  const peekNeedsFullTranscript = !liveSession?.transcriptMemoryUnlimited;

  useEffect(() => {
    if (!open || !sessionId || !onReloadFullDiskTranscript || !peekTranscriptTargetId) return;
    if (diskReloadAttemptedRef.current === sessionId) return;
    if (!peekNeedsFullTranscript) return;
    if (peekTranscriptStatus === "running" || peekTranscriptStatus === "connecting") return;
    if (!peekTranscriptClaudeId) return;
    diskReloadAttemptedRef.current = sessionId;
    void onReloadFullDiskTranscript(peekTranscriptTargetId);
  }, [
    open,
    sessionId,
    onReloadFullDiskTranscript,
    peekTranscriptTargetId,
    peekNeedsFullTranscript,
    peekTranscriptStatus,
    peekTranscriptClaudeId,
  ]);

  const refreshDrawerSnapshot = useCallback(() => {
    if (!sessionId) return;
    const found = resolveLiveSession(sessionId, transcriptSourceSessions);
    if (!found) {
      message.warning("未找到该会话");
      return;
    }
    if (onReloadFullDiskTranscript && found.claudeSessionId?.trim()) {
      diskReloadAttemptedRef.current = null;
      void onReloadFullDiskTranscript(found.id);
      return;
    }
    setDrawerSessionSnapshot(cloneSessionForDrawerSnapshot(found));
  }, [sessionId, transcriptSourceSessions, onReloadFullDiskTranscript]);

  const liveStatus = liveSession?.status;
  const snapshotFrozen =
    liveStatus === "running" || liveStatus === "connecting";
  const displaySession =
    snapshotFrozen && drawerSessionSnapshot ? drawerSessionSnapshot : liveSession;
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
        message.success("会话历史已压缩");
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
      classNames={{ body: "app-monitor-panel__history-session-drawer-body" }}
      extra={
        liveSession ? (
          <Space size="small" wrap align="center">
            <Tag color={historySessionStatusTagColor(liveSession.status)}>
              {historySessionStatusLabel(liveSession.status)}
            </Tag>
            {snapshotFrozen ? (
              <Tag color="default">已冻结快照</Tag>
            ) : null}
            <Tooltip title="从当前会话状态重新抓取消息列表">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label="刷新消息列表"
                onClick={refreshDrawerSnapshot}
              />
            </Tooltip>
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
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            displaySession.claudeSessionId?.trim()
              ? "该会话暂无消息，可能任务未成功启动或 transcript 尚未落盘"
              : "暂无消息"
          }
        />
      ) : (
        <div className="app-monitor-panel__history-session-drawer-scroll">
          <ClaudeSessionMessagesColumn
            session={displaySession}
            onOpenTaskDetail={onOpenTaskDetail}
            showAllMessages
          />
        </div>
      )}
    </Drawer>
  );
}
