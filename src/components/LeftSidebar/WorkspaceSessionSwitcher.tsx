import { useEffect, useState } from "react";
import { Popover } from "antd";
import type { ClaudeSession } from "../../types";
import { getSessionPreview } from "../ClaudeSessions/claudeChatHelpers";
import { clearCompletedSessionRecords, useExecutedSessionIds } from "../../stores/claudeSessionsLiveStore";
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

export function sessionSwitchShortcut(event: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "defaultPrevented" | "isComposing">) {
  if (event.defaultPrevented || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
  return { group: event.shiftKey ? "completed" as const : "running" as const, direction: event.key === "ArrowDown" ? 1 : -1 };
}

export function WorkspaceSessionSwitcher({ sessions, activeSessionId, onSelectSession }: {
  sessions: readonly ClaudeSession[];
  activeSessionId: string | null;
  onSelectSession?: (id: string) => void;
}) {
  const [openGroup, setOpenGroup] = useState<"running" | "completed" | null>(null);
  const setOpen = (open: boolean) => { if (!open) setOpenGroup(null); };
  const { running, completed } = groupOpenedSessions(sessions, useExecutedSessionIds());
  const select = (id: string) => { onSelectSession?.(id); setOpen(false); };
  const cycle = (items: readonly ClaudeSession[], direction: number) => {
    const target = nextRunningSession(items, activeSessionId, direction);
    if (target) select(target.id);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!onSelectSession) return;
      const shortcut = sessionSwitchShortcut(event);
      if (!shortcut) return;
      const items = shortcut.group === "running" ? running : completed;
      const target = nextRunningSession(items, activeSessionId, shortcut.direction);
      if (!target) return;
      event.preventDefault();
      if (target) { onSelectSession(target.id); setOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, completed, activeSessionId, onSelectSession]);
  return (
    <span className="workspace-session-switcher" onClick={(event) => event.stopPropagation()}>
      {(["running", "completed"] as const).map((group) => {
        const isRunning = group === "running";
        const label = isRunning ? "运行中" : "已完成";
        const items = isRunning ? running : completed;
        return <Popover key={group} trigger="click" placement="bottomLeft" open={openGroup === group} onOpenChange={(open) => setOpenGroup(open ? group : null)} content={
          <div className="workspace-session-switcher-panel" aria-label={`${label}会话`}>
            <div className="workspace-session-switcher-panel-head">
              <strong>{label} · {items.length}</strong>
              <span>
                <button type="button" disabled={!items.length || !onSelectSession} title={`上一个${label}会话（Alt + ${isRunning ? "" : "Shift + "}↑）`} aria-label={`上一个${label}会话`} onClick={() => cycle(items, -1)}>↑</button>
                <button type="button" disabled={!items.length || !onSelectSession} title={`下一个${label}会话（Alt + ${isRunning ? "" : "Shift + "}↓）`} aria-label={`下一个${label}会话`} onClick={() => cycle(items, 1)}>↓</button>
                {!isRunning && <button type="button" disabled={!completed.length} onClick={() => clearCompletedSessionRecords(completed.map(session => session.id))}>一键清空</button>}
              </span>
            </div>
            <div className="workspace-session-switcher-list">
              {items.length === 0 && <div className="workspace-session-switcher-empty">暂无会话</div>}
              {items.map((session) => (
                <div className="workspace-session-switcher-item" key={session.id}>
                  <button type="button" disabled={!onSelectSession} className="workspace-session-switcher-row" title={`${getSessionPreview(session)} · ${session.repositoryName || session.repositoryPath}`} aria-current={session.id === activeSessionId || session.claudeSessionId === activeSessionId ? 'true' : undefined} onClick={() => select(session.id)}>
                    <span className={`workspace-session-switcher-${group}`}>{isRunning ? '●' : '✓'}</span>
                    <span className="workspace-session-switcher-row-text"><span>{getSessionPreview(session)}</span><small>{session.repositoryName || session.repositoryPath}</small></span>
                  </button>
                  {!isRunning && <button type="button" className="workspace-session-switcher-clear" aria-label={`清空已完成会话 ${getSessionPreview(session)}`} title="清空此记录" onClick={() => clearCompletedSessionRecords([session.id])}>×</button>}
                </div>
              ))}
            </div>
            <div className="workspace-session-switcher-hint">Alt + {isRunning ? "" : "Shift + "}↑ / ↓ 切换{label}会话</div>
          </div>
        }>
          <button type="button" className={`workspace-session-switcher-trigger workspace-session-switcher-${group}`} aria-label={`${label} ${items.length}，打开${label}会话列表`} aria-expanded={openGroup === group} title={`${label}会话`}>
            {isRunning ? '●' : '✓'} {items.length}
          </button>
        </Popover>;
      })}
    </span>
  );
}
