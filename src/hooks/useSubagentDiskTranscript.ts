import { useEffect, useState } from "react";
import type { ClaudeSession } from "../types";
import { CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD } from "../constants/claudeMessageListWindow";
import { loadClaudeSessionJsonl } from "../services/claudeDisk";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import {
  capSessionMessagesForMemory,
  sessionMessagesFromJsonlLines,
  trimMessagePartsForMemory,
} from "../utils/sessionMessagesMemory";

const RUNNING_POLL_MS = 5000;
const RUNNING_POLL_MS_HIDDEN = 15000;

export function pickSubagentTranscriptSession(
  disk: ClaudeSession | null | undefined,
  matched: ClaudeSession | null | undefined,
  synthetic: ClaudeSession | null | undefined,
): ClaudeSession | null {
  if (disk && disk.messages.length > 0) return disk;
  if (matched && matched.messages.length > 0) return matched;
  return synthetic ?? null;
}

/**
 * 监控台子代理执行记录：从 Claude Code 磁盘 `*.jsonl` 加载并解析为与会话列表相同的消息结构。
 * 运行中定期轮询，避免仅展示 monitor 元数据里截断的 preview 行。
 */
export function useSubagentDiskTranscript(params: {
  enabled: boolean;
  repositoryPath: string;
  repositoryName: string;
  claudeSessionId: string;
  model?: string;
  status: ClaudeSession["status"];
  createdAt?: number;
  pollWhileRunning?: boolean;
}): { session: ClaudeSession | null; loading: boolean } {
  const {
    enabled,
    repositoryPath,
    repositoryName,
    claudeSessionId,
    model = "",
    status,
    createdAt,
    pollWhileRunning = true,
  } = params;

  const [session, setSession] = useState<ClaudeSession | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const rp = repositoryPath.trim();
    const cc = claudeSessionId.trim();
    if (!enabled || !rp || !cc) {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      setLoading(true);
      try {
        const lines = await loadClaudeSessionJsonl(rp, cc, {
          tailLines: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
        });
        if (cancelled) return;
        const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
          tailRequestLines: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
        });
        if (messages.length === 0) {
          setSession(null);
          return;
        }
        const memoryMessages = trimMessagePartsForMemory(capSessionMessagesForMemory(messages));
        setSession({
          id: cc,
          claudeSessionId: cc,
          repositoryPath: rp,
          repositoryName,
          model,
          status,
          createdAt: createdAt ?? Date.now(),
          pendingPrompt: "",
          messages: memoryMessages,
          diskTranscriptPartial,
        });
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const subPrimaryMs = RUNNING_POLL_MS;
    const subHiddenMs = RUNNING_POLL_MS_HIDDEN;
    const subVisibleMs = isCurrentPrimaryMainWorkspaceWindowSync() ? subPrimaryMs : subHiddenMs;
    if (pollWhileRunning && (status === "running" || status === "connecting")) {
      timer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        void load();
      }, readVisiblePollIntervalMs(subVisibleMs, subHiddenMs * 2));
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [
    enabled,
    repositoryPath,
    repositoryName,
    claudeSessionId,
    model,
    status,
    createdAt,
    pollWhileRunning,
  ]);

  return { session, loading };
}
