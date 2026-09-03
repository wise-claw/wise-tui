import { useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import type { ClaudeSession, ClaudeSessionInfo } from "../../types";
import { listRunningClaudeSessions } from "../../services/claude";
import { isClaudeSessionRunningInHostOrUi } from "../../services/claudeSessionState";
import { startAdaptiveInterval } from "../../utils/adaptivePoll";
import {
  getSystemResourceSnapshotStoreState,
  subscribeSystemResourceSnapshot,
} from "../../stores/systemResourceSnapshotStore";
import {
  matchSessionByKeyword,
  normalizeSearchKeyword,
  sessionUpdatedAt,
} from "../ProgressMonitorPanel/progressMonitorSearch";
import { getSessionPreview } from "../ProgressMonitorPanel/historySessionDrawerChrome";
import {
  buildHostClaudeProcessSession,
  buildRegistryOrphanClaudeSession,
  parseHostProcessDrawerPid,
  parseRegistryOrphanClaudeSid,
} from "./systemSessions";

interface UseSystemResourceSessionsInput {
  sessionsRef: RefObject<readonly ClaudeSession[]>;
  sessionsStructureKey: string;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
}

export function useSystemResourceSessions({
  sessionsRef,
  sessionsStructureKey,
  onCancelSessionFromMonitor,
  onReloadFullDiskTranscript,
}: UseSystemResourceSessionsInput) {
  const storeState = useSyncExternalStore(
    subscribeSystemResourceSnapshot,
    getSystemResourceSnapshotStoreState,
    getSystemResourceSnapshotStoreState,
  );
  const systemSummary = storeState.snapshot;
  const systemSummaryError = storeState.error;
  const [registryRunningClaude, setRegistryRunningClaude] = useState<ClaudeSessionInfo[]>([]);
  const [claudeCountPopoverOpen, setClaudeCountPopoverOpen] = useState(false);
  const [claudeSystemSessionSearch, setClaudeSystemSessionSearch] = useState("");
  const [systemSessionDrawerId, setSystemSessionDrawerId] = useState<string | null>(null);
  const systemSessionDetailOpen = claudeCountPopoverOpen || systemSessionDrawerId != null;

  useEffect(() => {
    let cancelled = false;
    async function refreshRegistry() {
      try {
        const list = await listRunningClaudeSessions();
        if (cancelled) return;
        const nextRunning = list.filter((item) => item.status === "running");
        setRegistryRunningClaude((prev) => {
          if (
            prev.length === nextRunning.length &&
            prev.every((item, index) => {
              const next = nextRunning[index];
              return next != null
                && item.session_id === next.session_id
                && item.project_path === next.project_path
                && item.model === next.model
                && item.status === next.status
                && item.started_at === next.started_at;
            })
          ) {
            return prev;
          }
          return nextRunning;
        });
      } catch {
        if (!cancelled) {
          setRegistryRunningClaude((prev) => (prev.length === 0 ? prev : []));
        }
      }
    }

    void refreshRegistry();
    const stopPoll = startAdaptiveInterval(
      refreshRegistry,
      systemSessionDetailOpen ? 8000 : 22000,
      systemSessionDetailOpen ? 20000 : 90000,
    );
    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [systemSessionDetailOpen]);

  const systemInlineSessionKeyword = normalizeSearchKeyword(claudeSystemSessionSearch);
  const claudeRegistryRunningIds = useMemo(
    () => new Set(registryRunningClaude.map((item) => item.session_id.trim()).filter(Boolean)),
    [registryRunningClaude],
  );

  const runningClaudeCodeSessions = useMemo(() => {
    const sessions = sessionsRef.current;
    const picked = sessions.filter((session) => isClaudeSessionRunningInHostOrUi(session, claudeRegistryRunningIds));
    const byId = new Map<string, ClaudeSession>();
    for (const session of picked) {
      byId.set(session.id, session);
    }
    return [...byId.values()].sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a));
  }, [sessionsRef, sessionsStructureKey, claudeRegistryRunningIds]);

  const registryOrphanClaudeSessions = useMemo(() => {
    const sessions = sessionsRef.current;
    const sessionClaudeIdSet = new Set(
      sessions
        .map((session) => session.claudeSessionId?.trim())
        .filter((id): id is string => Boolean(id && id.length > 0)),
    );
    const seenSid = new Set<string>();
    const out: ClaudeSession[] = [];
    for (const info of registryRunningClaude) {
      const sid = info.session_id.trim();
      if (!sid || sessionClaudeIdSet.has(sid) || seenSid.has(sid)) continue;
      seenSid.add(sid);
      out.push(buildRegistryOrphanClaudeSession(info));
    }
    return out;
  }, [sessionsRef, sessionsStructureKey, registryRunningClaude]);

  const hostProcessClaudeSessions = useMemo(() => {
    const coveredSids = new Set<string>();
    for (const session of [...runningClaudeCodeSessions, ...registryOrphanClaudeSessions]) {
      const sid = session.claudeSessionId?.trim();
      if (sid) coveredSids.add(sid);
    }
    for (const info of registryRunningClaude) {
      const sid = info.session_id.trim();
      if (sid) coveredSids.add(sid);
    }
    const seenPid = new Set<number>();
    const out: ClaudeSession[] = [];
    for (const proc of systemSummary.claudeProcesses) {
      if (!Number.isFinite(proc.pid) || proc.pid <= 0 || seenPid.has(proc.pid)) continue;
      const sid = proc.sessionId?.trim() ?? "";
      if (sid && coveredSids.has(sid)) continue;
      seenPid.add(proc.pid);
      out.push(buildHostClaudeProcessSession(proc));
    }
    return out;
  }, [
    systemSummary.claudeProcesses,
    runningClaudeCodeSessions,
    registryOrphanClaudeSessions,
    registryRunningClaude,
  ]);

  const systemInlineRunningSessionsCombined = useMemo(
    () =>
      [...runningClaudeCodeSessions, ...registryOrphanClaudeSessions, ...hostProcessClaudeSessions].sort(
        (a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a),
      ),
    [runningClaudeCodeSessions, registryOrphanClaudeSessions, hostProcessClaudeSessions],
  );

  const matchedSystemInlineSessions = useMemo(() => {
    return systemInlineRunningSessionsCombined
      .filter((item) => matchSessionByKeyword(item, systemInlineSessionKeyword))
      .slice(0, 80);
  }, [systemInlineRunningSessionsCombined, systemInlineSessionKeyword]);

  const systemSessionDrawerWidth = useMemo(
    () => Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560),
    [],
  );

  const liveSystemDrawerSession = useMemo(() => {
    if (!systemSessionDrawerId) return undefined;
    return sessionsRef.current.find(
      (item) => item.id === systemSessionDrawerId || item.claudeSessionId === systemSessionDrawerId,
    );
  }, [systemSessionDrawerId, sessionsRef, sessionsStructureKey]);

  const drawerRegistryOrphanSid = useMemo(
    () => (systemSessionDrawerId ? parseRegistryOrphanClaudeSid(systemSessionDrawerId) : null),
    [systemSessionDrawerId],
  );

  const drawerHostProcessPid = useMemo(
    () => (systemSessionDrawerId ? parseHostProcessDrawerPid(systemSessionDrawerId) : null),
    [systemSessionDrawerId],
  );

  const drawerHostProcess = useMemo(() => {
    if (drawerHostProcessPid == null) return undefined;
    return systemSummary.claudeProcesses.find((item) => item.pid === drawerHostProcessPid);
  }, [drawerHostProcessPid, systemSummary.claudeProcesses]);

  const systemDrawerTranscriptTargetId = liveSystemDrawerSession?.id ?? null;
  const systemDrawerTranscriptMessagesLen = liveSystemDrawerSession?.messages.length ?? 0;
  const systemDrawerTranscriptStatus = liveSystemDrawerSession?.status;
  const systemDrawerTranscriptClaudeId = liveSystemDrawerSession?.claudeSessionId?.trim() ?? "";

  useEffect(() => {
    if (
      !systemSessionDrawerId ||
      drawerRegistryOrphanSid ||
      drawerHostProcessPid != null ||
      !onReloadFullDiskTranscript ||
      !systemDrawerTranscriptTargetId
    ) {
      return;
    }
    if (systemDrawerTranscriptMessagesLen > 0) return;
    if (systemDrawerTranscriptStatus === "running" || systemDrawerTranscriptStatus === "connecting") return;
    if (!systemDrawerTranscriptClaudeId) return;
    void onReloadFullDiskTranscript(systemDrawerTranscriptTargetId);
  }, [
    systemSessionDrawerId,
    drawerRegistryOrphanSid,
    drawerHostProcessPid,
    onReloadFullDiskTranscript,
    systemDrawerTranscriptTargetId,
    systemDrawerTranscriptMessagesLen,
    systemDrawerTranscriptStatus,
    systemDrawerTranscriptClaudeId,
  ]);

  const drawerRegistryOrphanInfo = useMemo(() => {
    if (!drawerRegistryOrphanSid) return undefined;
    return registryRunningClaude.find((item) => item.session_id.trim() === drawerRegistryOrphanSid);
  }, [drawerRegistryOrphanSid, registryRunningClaude]);

  const systemSessionDrawerTitle = useMemo(() => {
    if (drawerHostProcess) {
      const path = drawerHostProcess.projectPath?.trim() ?? "";
      if (path.length > 0) return path;
      return `Claude 进程 · PID ${drawerHostProcess.pid}`;
    }
    if (drawerRegistryOrphanInfo) {
      const path = drawerRegistryOrphanInfo.project_path.trim();
      return path.length > 0 ? path : "Claude 进程（未绑定 Wise 会话）";
    }
    if (!liveSystemDrawerSession) return "会话消息";
    const name = liveSystemDrawerSession.repositoryName?.trim();
    return name && name.length > 0 ? name : getSessionPreview(liveSystemDrawerSession);
  }, [drawerHostProcess, drawerRegistryOrphanInfo, liveSystemDrawerSession]);

  const canStopSystemDrawerSession =
    Boolean(onCancelSessionFromMonitor) &&
    liveSystemDrawerSession != null &&
    isClaudeSessionRunningInHostOrUi(liveSystemDrawerSession, claudeRegistryRunningIds);

  return {
    claudeRegistryRunningIds,
    systemSummary,
    systemSummaryError,
    claudeCountPopoverOpen,
    setClaudeCountPopoverOpen,
    claudeSystemSessionSearch,
    setClaudeSystemSessionSearch,
    systemSessionDrawerId,
    setSystemSessionDrawerId,
    matchedSystemInlineSessions,
    systemInlineRunningSessionsCombined,
    systemSessionDrawerWidth,
    liveSystemDrawerSession,
    drawerRegistryOrphanSid,
    drawerRegistryOrphanInfo,
    drawerHostProcessPid,
    drawerHostProcess,
    systemSessionDrawerTitle,
    canStopSystemDrawerSession,
  };
}
