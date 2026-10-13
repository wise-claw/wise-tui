import { useEffect, useState } from "react";
import { Popover } from "antd";
import type { ClaudeSession } from "../../types";
import { getSessionPreview } from "../ClaudeSessions/claudeChatHelpers";
import { getExecutedSessionIds } from "../../stores/claudeSessionsLiveStore";
import "./WorkspaceSessionSwitcher.css";

export function groupOpenedSessions(sessions: readonly ClaudeSession[], executedIds: ReadonlySet<string>) {
  const running: ClaudeSession[] = [];
  const completed: ClaudeSession[] = [];
  for (const session of sessions) {
    if (session.isSide) continue;
    if (session.status === "running" || session.status === "connecting") running.push(session);
    else if (executedIds.has(session.id) && (session.status === "completed" || session.status === "idle")) completed.push(session);
  }
  return { running, completed };
}

export function nextRunningSession(sessions: readonly ClaudeSession[], activeId: string | null, direction: number) {
  if (!sessions.length) return undefined;
  const index = sessions.findIndex((session) => session.id === activeId || session.claudeSessionId === activeId);
  return sessions[index < 0 ? (direction > 0 ? 0 : sessions.length - 1) : (index + direction + sessions.length) % sessions.length];
}

export function WorkspaceSessionSwitcher({ sessions, activeSessionId, onSelectSession }: {
  sessions: readonly ClaudeSession[];
  activeSessionId: string | null;
  onSelectSession?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { running, completed } = groupOpenedSessions(sessions, getExecutedSessionIds());
  const select = (id: string) => { onSelectSession?.(id); setOpen(false); };
  const cycle = (direction: number) => {
    const target = nextRunningSession(running, activeSessionId, direction);
    if (target) select(target.id);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!onSelectSession || !running.length || event.defaultPrevented || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const target = nextRunningSession(running, activeSessionId, event.key === "ArrowDown" ? 1 : -1);
      if (target) { onSelectSession(target.id); setOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessions, activeSessionId, onSelectSession]);
  return (
    <span className="workspace-session-switcher" onClick={(event) => event.stopPropagation()}>
      <Popover trigger="click" placement="bottomLeft" open={open} onOpenChange={setOpen} content={
        <div className="workspace-session-switcher-panel" aria-label="已打开的会话">
          <div className="workspace-session-switcher-panel-head">
            <strong>已打开的会话</strong>
            <span>
              <button type="button" disabled={!running.length || !onSelectSession} title="上一个运行中会话（Alt + ↑）" aria-label="上一个运行中会话" onClick={() => cycle(-1)}>↑</button>
              <button type="button" disabled={!running.length || !onSelectSession} title="下一个运行中会话（Alt + ↓）" aria-label="下一个运行中会话" onClick={() => cycle(1)}>↓</button>
            </span>
          </div>
          <div className="workspace-session-switcher-list">
            {([['运行中', running], ['已完成', completed]] as const).map(([label, items]) => (
              <section key={label}>
                <div className="workspace-session-switcher-group"><span>{label} · {items.length}</span>{items.length === 0 && <span className="workspace-session-switcher-empty">暂无会话</span>}</div>
                {items.map((session) => (
                  <button type="button" key={session.id} disabled={!onSelectSession} className="workspace-session-switcher-row" title={`${session.threadName?.trim() || getSessionPreview(session) || '新会话'} · ${session.repositoryName || session.repositoryPath}`} aria-current={session.id === activeSessionId || session.claudeSessionId === activeSessionId ? 'true' : undefined} onClick={() => select(session.id)}>
                    <span className={label === '运行中' ? 'workspace-session-switcher-running' : 'workspace-session-switcher-completed'}>{label === '运行中' ? '●' : '✓'}</span>
                    <span className="workspace-session-switcher-row-text"><span>{session.threadName?.trim() || getSessionPreview(session) || '新会话'}</span><small>{session.repositoryName || session.repositoryPath}</small></span>
                  </button>
                ))}
              </section>
            ))}
          </div>
          <div className="workspace-session-switcher-hint">Alt + ↑ / ↓ 切换运行中会话</div>
        </div>
      }>
        <button type="button" className="workspace-session-switcher-trigger" aria-label={`运行中 ${running.length}，已完成 ${completed.length}，打开会话列表`} aria-expanded={open} title="已打开的会话">
          <span className="workspace-session-switcher-running">● {running.length}</span><span className="workspace-session-switcher-completed">✓ {completed.length}</span>
        </button>
      </Popover>
    </span>
  );
}
