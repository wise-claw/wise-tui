import { Button, Drawer, Empty, Space, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ClaudeSession } from "../../types";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  HistorySessionDrawerTitle,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";

export interface MonitorHistorySessionTranscriptDrawerProps {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  /** 与监控台一致：用于解析抽屉内会话（可与节流列表分离） */
  transcriptSourceSessions: ClaudeSession[];
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onCancelSession?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
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
}: MonitorHistorySessionTranscriptDrawerProps) {
  const [compactInFlight, setCompactInFlight] = useState(false);
  const drawerWidth = useMemo(
    () => Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560),
    [],
  );

  const liveSession = useMemo(() => {
    if (!sessionId) return undefined;
    return transcriptSourceSessions.find(
      (item) => item.id === sessionId || item.claudeSessionId === sessionId,
    );
  }, [sessionId, transcriptSourceSessions]);

  const peekTranscriptTargetId = liveSession?.id ?? null;
  const peekTranscriptMessagesLen = liveSession?.messages.length ?? 0;
  const peekTranscriptStatus = liveSession?.status;
  const peekTranscriptClaudeId = liveSession?.claudeSessionId?.trim() ?? "";

  useEffect(() => {
    if (!sessionId || !onReloadFullDiskTranscript || !peekTranscriptTargetId) return;
    if (peekTranscriptMessagesLen > 0) return;
    if (peekTranscriptStatus === "running" || peekTranscriptStatus === "connecting") return;
    if (!peekTranscriptClaudeId) return;
    void onReloadFullDiskTranscript(peekTranscriptTargetId);
  }, [
    sessionId,
    onReloadFullDiskTranscript,
    peekTranscriptTargetId,
    peekTranscriptMessagesLen,
    peekTranscriptStatus,
    peekTranscriptClaudeId,
  ]);

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

  function compactSessionHistory() {
    if (!onCompactSessionHistory || !liveSession || !canCompactSession) return;
    setCompactInFlight(true);
    void Promise.resolve(onCompactSessionHistory(liveSession.id))
      .then(() => {
        message.success("会话历史已压缩");
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
      title={<HistorySessionDrawerTitle session={liveSession} />}
      open={open}
      onClose={onClose}
      placement="right"
      destroyOnHidden
      size={drawerWidth}
      classNames={{ body: "app-monitor-panel__history-session-drawer-body" }}
      extra={
        liveSession ? (
          <Space size="small" wrap align="center">
            <Tag color={historySessionStatusTagColor(liveSession.status)}>
              {historySessionStatusLabel(liveSession.status)}
            </Tag>
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
                停止
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      {!liveSession ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该会话" />
      ) : (
        <div className="app-monitor-panel__history-session-drawer-scroll">
          <ClaudeSessionMessagesColumn
            session={liveSession}
            onOpenTaskDetail={onOpenTaskDetail}
            showAllMessages
          />
        </div>
      )}
    </Drawer>
  );
}
