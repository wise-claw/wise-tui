import { useEffect, useMemo, useState } from "react";
import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo } from "../../types";
import { listRunningClaudeSessions } from "../../services/claude";
import { isClaudeSessionRunningInHostOrUi } from "../../services/claudeSessionState";
import { getSystemResourceSnapshot } from "../../services/systemResource";
import {
  matchSessionByKeyword,
  normalizeSearchKeyword,
  sessionUpdatedAt,
} from "../ProgressMonitorPanel/progressMonitorSearch";
import { getSessionPreview } from "../ProgressMonitorPanel";
import {
  buildHostClaudeProcessSession,
  buildRegistryOrphanClaudeSession,
  parseHostProcessDrawerPid,
  parseRegistryOrphanClaudeSid,
} from "./systemSessions";

interface UseSystemResourceSessionsInput {
  sessions: ClaudeSession[];
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
}

export function useSystemResourceSessions({
  sessions,
  onCancelSessionFromMonitor,
  onReloadFullDiskTranscript,
}: UseSystemResourceSessionsInput) {
  const [systemSummary, setSystemSummary] = useState({
    systemTotalBytes: 0,
    systemUsedBytes: 0,
    appMemoryBytes: 0,
    claudeProcessCount: 0,
    claudeMemoryBytes: 0,
    claudeProcesses: [] as ClaudeHostProcess[],
  });
  const [systemSummaryError, setSystemSummaryError] = useState(false);
  const [registryRunningClaude, setRegistryRunningClaude] = useState<ClaudeSessionInfo[]>([]);
  const [claudeCountPopoverOpen, setClaudeCountPopoverOpen] = useState(false);
  const [claudeSystemSessionSearch, setClaudeSystemSessionSearch] = useState("");
  const [systemSessionDrawerId, setSystemSessionDrawerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const visiblePollIntervalMs = 8000;
    const hiddenPollIntervalMs = 20000;

    async function refreshSystemSummary() {
      const [snapshotResult, registryResult] = await Promise.allSettled([
        getSystemResourceSnapshot(),
        listRunningClaudeSessions(),
      ]);
      if (cancelled) return;
      if (snapshotResult.status === "fulfilled") {
        const snap = snapshotResult.value;
        setSystemSummary({
          ...snap,
          claudeProcesses: snap.claudeProcesses ?? [],
        });
        setSystemSummaryError(false);
      } else {
        setSystemSummaryError(true);
      }
      if (registryResult.status === "fulfilled") {
        setRegistryRunningClaude(
          registryResult.value.filter((item) => item.status === "running"),
        );
      } else {
        setRegistryRunningClaude([]);
      }
    }

    void refreshSystemSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshSystemSummary();
    }, document.visibilityState === "visible" ? visiblePollIntervalMs : hiddenPollIntervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSystemSummary();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const systemInlineSessionKeyword = normalizeSearchKeyword(claudeSystemSessionSearch);
  const claudeRegistryRunningIds = useMemo(
    () => new Set(registryRunningClaude.map((item) => item.session_id.trim()).filter(Boolean)),
    [registryRunningClaude],
  );

  const runningClaudeCodeSessions = useMemo(() => {
    const picked = sessions.filter((session) => isClaudeSessionRunningInHostOrUi(session, claudeRegistryRunningIds));
    const byId = new Map<string, ClaudeSession>();
    for (const session of picked) {
      byId.set(session.id, session);
    }
    return [...byId.values()].sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a));
  }, [sessions, claudeRegistryRunningIds]);

  const registryOrphanClaudeSessions = useMemo(() => {
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
  }, [sessions, registryRunningClaude]);

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
    return sessions.find(
      (item) => item.id === systemSessionDrawerId || item.claudeSessionId === systemSessionDrawerId,
    );
  }, [systemSessionDrawerId, sessions]);

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
