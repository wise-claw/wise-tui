import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ClaudeSession } from "../types";
import { indexOfLastRenderableUserMessage, isAssistantDisplayNoiseText } from "../utils/claudeChatMessageDisplay";
import { assistantMessageVisiblePlainText } from "../services/claudeSessionState";
import { MONITOR_SESSIONS_SYNC_INTERVAL_MS } from "../constants/monitorUi";
import { runWhenIdle } from "../utils/deferIdle";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
import { subscribeClaudeSessionsStructure } from "../stores/claudeSessionsLiveStore";

const MONITOR_FINGERPRINT_HIDDEN_INTERVAL_MS = MONITOR_SESSIONS_SYNC_INTERVAL_MS * 3;

function attachMonitorFingerprintPolling(
  commitIfChanged: () => void,
): () => void {
  let cancelIdle: (() => void) | null = null;
  let timer: number | null = null;

  const runCommit = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (cancelIdle) cancelIdle();
    cancelIdle = runWhenIdle(commitIfChanged, { timeoutMs: 1500 });
  };

  const scheduleTimer = () => {
    if (timer != null) window.clearInterval(timer);
    timer = window.setInterval(
      runCommit,
      readVisiblePollIntervalMs(
        MONITOR_SESSIONS_SYNC_INTERVAL_MS,
        MONITOR_FINGERPRINT_HIDDEN_INTERVAL_MS,
      ),
    );
  };

  scheduleTimer();
  const onVisibilityChange = () => {
    scheduleTimer();
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      commitIfChanged();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    if (timer != null) window.clearInterval(timer);
    if (cancelIdle) cancelIdle();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

function settledAssistantPreviewLengthBucket(session: ClaudeSession): string {
  if (session.status === "running" || session.status === "connecting") {
    return "";
  }
  const turnStart = indexOfLastRenderableUserMessage(session.messages);
  if (turnStart < 0) return "";
  let lastLen = 0;
  for (let i = turnStart + 1; i < session.messages.length; i += 1) {
    const msg = session.messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = assistantMessageVisiblePlainText(msg);
    if (text.trim() && !isAssistantDisplayNoiseText(text)) {
      lastLen = text.length;
    }
  }
  return lastLen > 0 ? String(Math.floor(lastLen / 64)) : "";
}

/** 流式正文增长时不变：用于监控指纹 cheap 短路，避免每 token 扫全量会话。 */
export function monitorSessionsCheapStatusKey(sessions: readonly ClaudeSession[]): string {
  const parts: string[] = [`n:${sessions.length}`];
  for (const s of sessions) {
    const last = s.messages[s.messages.length - 1];
    parts.push(
      [s.id, s.status, String(s.messages.length), last?.id ?? "", last?.role ?? ""].join("|"),
    );
  }
  return parts.join("\n");
}

/** 终端行状态推断：忽略流式正文长度，仅跟踪消息条数 / 末条角色与末轮用户索引。 */
export function monitorSessionsTerminalStatusFingerprint(sessions: readonly ClaudeSession[]): string {
  const parts: string[] = [`n:${sessions.length}`];
  for (const s of sessions) {
    const last = s.messages[s.messages.length - 1];
    const isStreaming = s.status === "running" || s.status === "connecting";
    const lastUserIdx = String(indexOfLastRenderableUserMessage(s.messages));
    parts.push(
      [
        s.id,
        s.status,
        s.claudeSessionId ?? "",
        s.repositoryPath,
        s.repositoryName ?? "",
        String(s.messages.length),
        lastUserIdx,
        last?.id ?? "",
        last?.role ?? "",
        isStreaming ? "" : settledAssistantPreviewLengthBucket(s),
      ].join("|"),
    );
  }
  return parts.join("\n");
}

/** 运行面板 / useMonitorOverview 指纹：与 terminal 一致，避免流式正文触发 App 级重算。 */
export function monitorSessionsOverviewFingerprint(sessions: readonly ClaudeSession[]): string {
  return monitorSessionsTerminalStatusFingerprint(sessions);
}

function commitMonitorSessionsFingerprint(
  sessions: ClaudeSession[],
  fingerprintRef: { current: string },
  onChanged: (next: ClaudeSession[]) => void,
): void {
  const fp = monitorSessionsTerminalStatusFingerprint(sessions);
  if (fp === fingerprintRef.current) return;
  fingerprintRef.current = fp;
  onChanged(sessions);
}

/** 侧栏监控面板 memo 用：节流指纹，避免 `sessions` 引用每 token 变化都扫全量列表。 */
export function useMonitorSessionsFingerprint(
  sessions: ClaudeSession[],
  enabled = true,
): string {
  const latestRef = useRef(sessions);
  latestRef.current = sessions;
  const [fingerprint, setFingerprint] = useState(() =>
    monitorSessionsTerminalStatusFingerprint(sessions),
  );

  const commitIfChanged = useCallback(() => {
    const fp = monitorSessionsTerminalStatusFingerprint(latestRef.current);
    setFingerprint((prev) => (prev === fp ? prev : fp));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    commitIfChanged();
    return attachMonitorFingerprintPolling(commitIfChanged);
  }, [commitIfChanged, enabled]);

  useEffect(() => {
    if (!enabled) return;
    commitIfChanged();
  }, [commitIfChanged, enabled, sessions.length]);

  return fingerprint;
}

export function useMonitorSidebarFingerprints(
  monitorSessions: ClaudeSession[],
  transcriptSessions: ClaudeSession[],
  enabled = true,
): { monitorSessionsFingerprint: string; transcriptSessionsFingerprint: string } {
  const monitorLatestRef = useRef(monitorSessions);
  const transcriptLatestRef = useRef(transcriptSessions);
  monitorLatestRef.current = monitorSessions;
  transcriptLatestRef.current = transcriptSessions;

  const [fingerprints, setFingerprints] = useState(() => {
    const transcript = monitorSessionsTerminalStatusFingerprint(transcriptSessions);
    return {
      monitorSessionsFingerprint:
        monitorSessions === transcriptSessions
          ? transcript
          : monitorSessionsTerminalStatusFingerprint(monitorSessions),
      transcriptSessionsFingerprint: transcript,
    };
  });

  const commitIfChanged = useCallback(() => {
    const transcript = monitorSessionsTerminalStatusFingerprint(transcriptLatestRef.current);
    const monitor =
      monitorLatestRef.current === transcriptLatestRef.current
        ? transcript
        : monitorSessionsTerminalStatusFingerprint(monitorLatestRef.current);
    setFingerprints((prev) =>
      prev.monitorSessionsFingerprint === monitor && prev.transcriptSessionsFingerprint === transcript
        ? prev
        : {
            monitorSessionsFingerprint: monitor,
            transcriptSessionsFingerprint: transcript,
          },
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    commitIfChanged();
    return attachMonitorFingerprintPolling(commitIfChanged);
  }, [commitIfChanged, enabled]);

  useEffect(() => {
    if (!enabled) return;
    commitIfChanged();
  }, [commitIfChanged, enabled, monitorSessions.length, transcriptSessions.length]);

  return fingerprints;
}

/**
 * 向 useMonitorOverview 提供会话列表：始终读最新 ref，仅在监控相关指纹变化时触发重算。
 * 避免主会话流式更新时周期性跑一遍巨型 useMonitorOverview。
 *
 * 传入 `sessionsLiveRef` 时从 live store 拉取，App 壳层 `subscribeLive: false` 下仍能保持监控同步。
 */
export function useMonitorSessionsForOverview(
  sessions: ClaudeSession[] | RefObject<readonly ClaudeSession[]>,
  enabled = true,
): ClaudeSession[] {
  const resolveLatest = useCallback((): ClaudeSession[] => {
    if (typeof sessions === "object" && sessions !== null && "current" in sessions) {
      return sessions.current as ClaudeSession[];
    }
    return sessions;
  }, [sessions]);

  const [synced, setSynced] = useState(() => resolveLatest());
  const latestRef = useRef(synced);
  const fingerprintRef = useRef(monitorSessionsTerminalStatusFingerprint(synced));
  const cheapStatusKeyRef = useRef(monitorSessionsCheapStatusKey(synced));
  latestRef.current = resolveLatest();

  useEffect(() => {
    if (!enabled) return;

    const commitIfChanged = () => {
      latestRef.current = resolveLatest();
      const cheapKey = monitorSessionsCheapStatusKey(latestRef.current);
      if (cheapKey === cheapStatusKeyRef.current && fingerprintRef.current !== "") {
        return;
      }
      cheapStatusKeyRef.current = cheapKey;
      commitMonitorSessionsFingerprint(latestRef.current, fingerprintRef, (next) => {
        startTransition(() => {
          setSynced(next);
        });
      });
    };

    let liveCommitRaf: number | null = null;
    const scheduleCommitIfChanged = () => {
      if (liveCommitRaf !== null) return;
      if (typeof window === "undefined") {
        commitIfChanged();
        return;
      }
      liveCommitRaf = window.requestAnimationFrame(() => {
        liveCommitRaf = null;
        commitIfChanged();
      });
    };

    commitIfChanged();
    const disposePolling = attachMonitorFingerprintPolling(commitIfChanged);

    const usesLiveRef = typeof sessions === "object" && sessions !== null && "current" in sessions;
    const unsubscribeStructure = usesLiveRef
      ? subscribeClaudeSessionsStructure(scheduleCommitIfChanged)
      : undefined;

    return () => {
      disposePolling();
      if (liveCommitRaf !== null) {
        window.cancelAnimationFrame(liveCommitRaf);
        liveCommitRaf = null;
      }
      unsubscribeStructure?.();
    };
  }, [enabled, resolveLatest, sessions]);

  return synced;
}
