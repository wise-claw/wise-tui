import { useEffect, useState } from "react";
import type { ClaudeSession } from "../types";
import { loadClaudeSessionJsonl } from "../services/claudeDisk";
import { parseClaudeSessionJsonlLines } from "../utils/claudeSessionJsonl";

const RUNNING_POLL_MS = 3000;

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
        const lines = await loadClaudeSessionJsonl(rp, cc);
        if (cancelled) return;
        const messages = parseClaudeSessionJsonlLines(lines);
        if (messages.length === 0) {
          setSession(null);
          return;
        }
        setSession({
          id: cc,
          claudeSessionId: cc,
          repositoryPath: rp,
          repositoryName,
          model,
          status,
          createdAt: createdAt ?? Date.now(),
          pendingPrompt: "",
          messages,
          diskTranscriptPartial: false,
        });
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    if (pollWhileRunning && (status === "running" || status === "connecting")) {
      timer = window.setInterval(() => {
        void load();
      }, RUNNING_POLL_MS);
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
