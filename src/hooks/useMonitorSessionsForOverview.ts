import { useEffect, useRef, useState } from "react";
import type { ClaudeSession } from "../types";
import { indexOfLastRenderableUserMessage } from "../utils/claudeChatMessageDisplay";
import { MONITOR_SESSIONS_SYNC_INTERVAL_MS } from "../constants/monitorUi";

/** 终端行状态推断：忽略流式正文长度，仅跟踪消息条数 / 末条角色与末轮用户索引。 */
export function monitorSessionsTerminalStatusFingerprint(sessions: readonly ClaudeSession[]): string {
  const parts: string[] = [`n:${sessions.length}`];
  for (const s of sessions) {
    const lastUserIdx = indexOfLastRenderableUserMessage(s.messages);
    const last = s.messages[s.messages.length - 1];
    parts.push(
      [
        s.id,
        s.status,
        s.claudeSessionId ?? "",
        s.repositoryPath,
        s.repositoryName ?? "",
        String(s.messages.length),
        String(lastUserIdx),
        last?.id ?? "",
        last?.role ?? "",
      ].join("|"),
    );
  }
  return parts.join("\n");
}

/** 运行面板 / useMonitorOverview 关心的会话字段；忽略流式正文逐 token 变化。 */
export function monitorSessionsOverviewFingerprint(sessions: readonly ClaudeSession[]): string {
  const parts: string[] = [`n:${sessions.length}`];
  for (const s of sessions) {
    const last = s.messages[s.messages.length - 1];
    const previewBucket =
      last?.content && last.content.length > 0 ? Math.floor(last.content.length / 280) : 0;
    parts.push(
      [
        s.id,
        s.status,
        s.claudeSessionId ?? "",
        s.repositoryPath,
        s.repositoryName ?? "",
        String(s.messages.length),
        last?.id ?? "",
        last?.role ?? "",
        String(previewBucket),
      ].join("|"),
    );
  }
  return parts.join("\n");
}

/**
 * 向 useMonitorOverview 提供会话列表：始终读最新 ref，仅在监控相关指纹变化时触发重算。
 * 避免主会话流式时每 380ms 跑一遍巨型 useMemo。
 */
export function useMonitorSessionsForOverview(sessions: ClaudeSession[]): ClaudeSession[] {
  const [synced, setSynced] = useState(sessions);
  const latestRef = useRef(sessions);
  const fingerprintRef = useRef(monitorSessionsOverviewFingerprint(sessions));
  latestRef.current = sessions;

  useEffect(() => {
    const commitIfChanged = () => {
      const next = latestRef.current;
      const fp = monitorSessionsOverviewFingerprint(next);
      if (fp === fingerprintRef.current) return;
      fingerprintRef.current = fp;
      setSynced(next);
    };

    commitIfChanged();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      commitIfChanged();
    }, MONITOR_SESSIONS_SYNC_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        commitIfChanged();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const next = latestRef.current;
    const fp = monitorSessionsOverviewFingerprint(next);
    if (fp === fingerprintRef.current) return;
    fingerprintRef.current = fp;
    setSynced(next);
  }, [sessions.length]);

  return synced;
}
