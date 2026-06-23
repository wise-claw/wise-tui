import { CloseOutlined } from "@ant-design/icons";
import { Empty, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClaudeSessionsLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import { cancelClaudeExecution, listRunningClaudeSessions } from "../../services/claude";
import { getSystemResourceSnapshot, killClaudeHostProcess } from "../../services/systemResource";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";
import {
  buildHostClaudeProcessSession,
  buildRegistryOrphanClaudeSession,
  HOST_PROCESS_ROW_ID_PREFIX,
  parseHostProcessDrawerPid,
  formatBytes,
} from "../LeftSidebar/systemSessions";
import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo } from "../../types";

interface Props {
  active: boolean;
  listSearch: string;
  onCountChange?: (count: number) => void;
}

interface ProcessItem {
  key: string;
  session: ClaudeSession;
  pid: number | null;
  memoryBytes: number;
}

const POLL_VISIBLE_MS = 8000;
const POLL_HIDDEN_MS = 22000;

export function ClaudeProcessPanel({ active, listSearch, onCountChange }: Props) {
  const liveSessions = useClaudeSessionsLiveSnapshot(active);
  const [hostProcesses, setHostProcesses] = useState<ClaudeHostProcess[]>([]);
  const [registrySessions, setRegistrySessions] = useState<ClaudeSessionInfo[]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const [snapshot, running] = await Promise.all([
        getSystemResourceSnapshot(),
        listRunningClaudeSessions(),
      ]);
      setHostProcesses(snapshot.claudeProcesses);
      setRegistrySessions(running);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    poll();
    const ms = readVisiblePollIntervalMs(POLL_VISIBLE_MS, POLL_HIDDEN_MS);
    const timer = setInterval(poll, ms);
    return () => clearInterval(timer);
  }, [active, poll]);

  const hostPidMap = useMemo(() => {
    const map = new Map<string, ClaudeHostProcess>();
    for (const proc of hostProcesses) {
      const sid = proc.sessionId?.trim();
      if (sid) map.set(sid, proc);
    }
    return map;
  }, [hostProcesses]);

  const combinedList = useMemo((): ProcessItem[] => {
    const result: ProcessItem[] = [];
    const seenClaudeSids = new Set<string>();
    const seenIds = new Set<string>();

    for (const session of liveSessions) {
      if (session.status !== "running" && session.status !== "connecting") continue;
      if (seenIds.has(session.id)) continue;
      seenIds.add(session.id);

      const claudeSid = session.claudeSessionId?.trim();
      let pid: number | null = null;
      let memoryBytes = 0;
      if (claudeSid && hostPidMap.has(claudeSid)) {
        const proc = hostPidMap.get(claudeSid)!;
        pid = proc.pid;
        memoryBytes = proc.memoryBytes;
      }

      if (claudeSid) seenClaudeSids.add(claudeSid);
      result.push({ key: session.id, session, pid, memoryBytes });
    }

    for (const info of registrySessions) {
      const sid = info.session_id.trim();
      if (seenClaudeSids.has(sid)) continue;
      const orphan = buildRegistryOrphanClaudeSession(info);
      if (seenIds.has(orphan.id)) continue;
      seenIds.add(orphan.id);
      seenClaudeSids.add(sid);

      const proc = hostPidMap.get(sid);
      result.push({
        key: orphan.id,
        session: orphan,
        pid: proc?.pid ?? null,
        memoryBytes: proc?.memoryBytes ?? 0,
      });
    }

    for (const proc of hostProcesses) {
      const psid = proc.sessionId?.trim() ?? "";
      if (psid && seenClaudeSids.has(psid)) continue;
      const hostSession = buildHostClaudeProcessSession(proc);
      if (seenIds.has(hostSession.id)) continue;
      seenIds.add(hostSession.id);

      result.push({
        key: hostSession.id,
        session: hostSession,
        pid: proc.pid,
        memoryBytes: proc.memoryBytes,
      });
    }

    const search = listSearch.trim().toLowerCase();
    if (search) {
      return result.filter((item) => {
        const s = item.session;
        const hay = [
          s.repositoryName,
          s.repositoryPath,
          s.claudeSessionId ?? "",
          item.pid != null ? String(item.pid) : "",
        ]
          .join("\n")
          .toLowerCase();
        return hay.includes(search);
      });
    }

    return result;
  }, [liveSessions, hostProcesses, hostPidMap, registrySessions, listSearch]);

  useEffect(() => {
    onCountChange?.(combinedList.length);
  }, [combinedList.length, onCountChange]);

  const handleStop = useCallback(async (item: ProcessItem) => {
    const { session } = item;
    setStoppingIds((prev) => {
      const next = new Set(prev);
      next.add(session.id);
      return next;
    });
    try {
      if (session.id.startsWith(HOST_PROCESS_ROW_ID_PREFIX)) {
        const pid = parseHostProcessDrawerPid(session.id);
        if (pid != null) {
          await killClaudeHostProcess(pid);
        }
      } else {
        await cancelClaudeExecution(session.id);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  }, []);

  if (combinedList.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行中的 Claude 进程" />;
  }

  return (
    <div className="app-claude-process-popover__list">
      {combinedList.map((item) => {
        const session = item.session;
        const claudeSessionId = session.claudeSessionId?.trim() ?? "";
        const truncatedSid =
          claudeSessionId.length > 12
            ? `${claudeSessionId.slice(0, 10)}…`
            : claudeSessionId || "—";
        const memoryLabel = item.memoryBytes > 0 ? formatBytes(item.memoryBytes) : null;
        const pidLabel = item.pid != null ? String(item.pid) : "—";
        const isStopping = stoppingIds.has(session.id);

        return (
          <article key={item.key} className="app-claude-process-popover__card">
            <div className="app-claude-process-popover__card-main">
              <div className="app-claude-process-popover__card-head">
                <span className="app-claude-process-popover__card-title">
                  {session.repositoryName}
                </span>
                <span className="app-claude-process-popover__card-head-actions">
                  <span
                    className="app-claude-process-popover__card-running"
                    aria-label="运行中"
                    title="运行中"
                  />
                  <span
                    role="button"
                    tabIndex={0}
                    className="app-claude-process-popover__card-stop"
                    aria-label="关闭 Claude 会话"
                    style={
                      isStopping
                        ? { opacity: 0.3, pointerEvents: "auto" as const }
                        : undefined
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isStopping) void handleStop(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!isStopping) void handleStop(item);
                      }
                    }}
                  >
                    <CloseOutlined />
                  </span>
                </span>
              </div>
              <div className="app-claude-process-popover__card-meta-grid">
                <div className="app-claude-process-popover__meta-cell">
                  <span className="app-claude-process-popover__meta-label">PID</span>
                  <span className="app-claude-process-popover__meta-value">{pidLabel}</span>
                </div>
                <div className="app-claude-process-popover__meta-cell">
                  <span className="app-claude-process-popover__meta-label">内存</span>
                  <span className="app-claude-process-popover__meta-value">
                    {memoryLabel ?? "—"}
                  </span>
                </div>
                <div className="app-claude-process-popover__meta-cell app-claude-process-popover__meta-cell--full">
                  <span className="app-claude-process-popover__meta-label">Claude 会话 ID</span>
                  <span className="app-claude-process-popover__meta-value app-claude-process-popover__meta-value--mono">
                    {truncatedSid}
                  </span>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
