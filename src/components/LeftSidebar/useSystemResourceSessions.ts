import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo } from "../../types";
import { listRunningClaudeSessions } from "../../services/claude";
import { isClaudeSessionRunningInHostOrUi } from "../../services/claudeSessionState";
import { getSystemResourceSnapshot } from "../../services/systemResource";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";
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
  const claudeCountPopoverOpenRef = useRef(false);
  const systemSessionDrawerIdRef = useRef<string | null>(null);
  claudeCountPopoverOpenRef.current = claudeCountPopoverOpen;
  systemSessionDrawerIdRef.current = systemSessionDrawerId;

  useEffect(() => {
    let cancelled = false;
    let tickCounter = 0;

    async function refreshSystemSummary() {
      tickCounter += 1;
      const detailOpen =
        claudeCountPopoverOpenRef.current || systemSessionDrawerIdRef.current != null;
      const includeSnapshot = detailOpen || tickCounter % 5 === 1;
      const registryPromise = listRunningClaudeSessions();
      const snapshotPromise = includeSnapshot
        ? getSystemResourceSnapshot()
        : Promise.resolve(null);
      const [snapshotResult, registryResult] = await Promise.allSettled([
        snapshotPromise,
        registryPromise,
      ]);
      if (cancelled) return;
      if (snapshotResult.status === "fulfilled" && snapshotResult.value) {
        const snap = snapshotResult.value;
        setSystemSummary((prev) => {
          const next = {
            ...snap,
            claudeProcesses: snap.claudeProcesses ?? [],
          };
          if (
            prev.systemTotalBytes === next.systemTotalBytes &&
            prev.systemUsedBytes === next.systemUsedBytes &&
            prev.appMemoryBytes === next.appMemoryBytes &&
            prev.claudeProcessCount === next.claudeProcessCount &&
            prev.claudeMemoryBytes === next.claudeMemoryBytes &&
            prev.claudeProcesses.length === next.claudeProcesses.length &&
            prev.claudeProcesses.every(
              (proc, index) =>
                proc.pid === next.claudeProcesses[index]?.pid &&
                proc.sessionId === next.claudeProcesses[index]?.sessionId,
            )
          ) {
            return prev;
          }
          return next;
        });
        setSystemSummaryError(false);
      } else if (includeSnapshot && snapshotResult.status === "rejected") {
        setSystemSummaryError(true);
      }
      if (registryResult.status === "fulfilled") {
        const nextRunning = registryResult.value.filter((item) => item.status === "running");
        setRegistryRunningClaude((prev) => {
          if (
            prev.length === nextRunning.length &&
            prev.every((item, index) => item.session_id === nextRunning[index]?.session_id)
          ) {
            return prev;
          }
          return nextRunning;
        });
      } else {
        setRegistryRunningClaude((prev) => (prev.length === 0 ? prev : []));
      }
    }

    void refreshSystemSummary();
    let timer: number | null = null;
    const scheduleTimer = () => {
      if (timer != null) window.clearInterval(timer);
      const detailOpen =
        claudeCountPopoverOpenRef.current || systemSessionDrawerIdRef.current != null;
      timer = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void refreshSystemSummary();
      }, readVisiblePollIntervalMs(detailOpen ? 8000 : 22000, detailOpen ? 20000 : 90000));
    };
    scheduleTimer();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSystemSummary();
        scheduleTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

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
