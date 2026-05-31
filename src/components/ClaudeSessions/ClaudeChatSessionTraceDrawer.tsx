import { Drawer, Empty, message } from "antd";
import { memo, type Dispatch, type SetStateAction } from "react";
import type { SessionSendTraceEntry } from "./ClaudeChatSessionFeatureShared";

export interface ClaudeChatSessionTraceDrawerProps {
  open: boolean;
  onClose: () => void;
  traceDrawerWidth: number;
  sessionId: string;
  sessionRepositoryPath: string;
  sessionSendTraces: SessionSendTraceEntry[];
  setSessionSendTraces: Dispatch<SetStateAction<SessionSendTraceEntry[]>>;
}

export const ClaudeChatSessionTraceDrawer = memo(function ClaudeChatSessionTraceDrawer(
  props: ClaudeChatSessionTraceDrawerProps,
) {
  const {
    open,
    onClose,
    traceDrawerWidth,
    sessionId,
    sessionRepositoryPath,
    sessionSendTraces,
    setSessionSendTraces,
  } = props;

  return (
    <Drawer
      title="会话跟踪"
      placement="right"
      size={traceDrawerWidth}
      open={open}
      onClose={onClose}
      destroyOnHidden
      styles={{ body: { padding: 12, overflow: "auto" } }}
    >
      <div className="app-claude-session-trace-list">
        <div className="app-claude-session-trace-actions">
          <button
            type="button"
            className="app-claude-session-trace-actions__btn"
            onClick={() => {
              if (sessionSendTraces.length === 0) {
                message.info("暂无可导出的跟踪记录");
                return;
              }
              const payload = {
                sessionId,
                repositoryPath: sessionRepositoryPath,
                exportedAt: Date.now(),
                traces: sessionSendTraces,
              };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `session-trace-${sessionId}-${Date.now()}.json`;
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              URL.revokeObjectURL(url);
              message.success("会话跟踪已导出");
            }}
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="app-claude-session-trace-actions__btn"
            onClick={() => {
              setSessionSendTraces([]);
              message.success("会话跟踪已清空");
            }}
          >
            清空记录
          </button>
        </div>
        {sessionSendTraces.length === 0 ? (
          <div className="app-claude-session-trace-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话跟踪记录" />
          </div>
        ) : (
          sessionSendTraces.map((entry) => (
            <div key={entry.id} className="app-claude-session-trace-card">
              <div className="app-claude-session-trace-card__head">
                <span className="app-claude-session-trace-card__title">发送时间</span>
                <span className="app-claude-session-trace-card__time">
                  {new Date(entry.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <div className="app-claude-session-trace-card__section">
                <div className="app-claude-session-trace-card__label">输入消息</div>
                <pre className="app-claude-session-trace-card__text">{entry.composerText || "(空)"}</pre>
              </div>
              <div className="app-claude-session-trace-card__section">
                <div className="app-claude-session-trace-card__label">发送消息内容</div>
                <pre className="app-claude-session-trace-card__text">{entry.outboundText || "(空)"}</pre>
              </div>
              <div className="app-claude-session-trace-card__section">
                <div className="app-claude-session-trace-card__label">关键节点</div>
                <ul className="app-claude-session-trace-card__timeline">
                  {entry.nodes.map((node, index) => (
                    <li key={`${entry.id}_${node.label}_${index}`} className="app-claude-session-trace-card__timeline-item">
                      <span className="app-claude-session-trace-card__timeline-time">
                        {new Date(node.timestamp).toLocaleTimeString("zh-CN")}
                      </span>
                      <span className="app-claude-session-trace-card__timeline-label">{node.label}</span>
                      {node.detail ? <span className="app-claude-session-trace-card__timeline-detail">{node.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))
        )}
      </div>
    </Drawer>
  );
});
