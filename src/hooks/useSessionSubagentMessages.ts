import { useEffect, useState } from "react";
import type { ClaudeMessage } from "../types";
import { loadClaudeSubagentJsonl } from "../services/claudeDisk";
import { loadNativeCliSessionTranscript } from "../services/nativeCliSessions";
import { CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD } from "../constants/claudeMessageListWindow";
import { sessionMessagesFromJsonlLines } from "../utils/sessionMessagesMemory";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

export function useSessionSubagentMessages(params: {
  repositoryPath: string;
  parentSessionId: string;
  toolUseId: string;
  agentId: string;
  codex: boolean;
  running: boolean;
  fullHistory: boolean;
  revision: number;
}) {
  const { repositoryPath, parentSessionId, toolUseId, agentId, codex, running, fullHistory, revision } = params;
  const key = JSON.stringify([repositoryPath, parentSessionId, toolUseId, agentId, codex]);
  const [state, setState] = useState<{ key: string; messages: ClaudeMessage[]; loading: boolean; partial: boolean; error: string }>(
    { key, messages: [], loading: true, partial: false, error: "" },
  );
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setState((previous) => previous.key === key
      ? { ...previous, loading: true, error: "" }
      : { key, messages: [], loading: true, partial: false, error: "" });
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const tailLines = fullHistory ? null : CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD;
        const lines = codex
          ? (agentId ? await loadNativeCliSessionTranscript("codex", repositoryPath, agentId, { tailLines }) : [])
          : (parentSessionId ? await loadClaudeSubagentJsonl(repositoryPath, parentSessionId, toolUseId, agentId, { tailLines }) : []);
        if (cancelled) return;
        const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
          tailRequestLines: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
          fullTranscript: fullHistory,
          unlimitedMessageCount: fullHistory,
        });
        setState({ key, messages, partial: diskTranscriptPartial, loading: false, error: "" });
      } catch (error) {
        if (!cancelled) setState((previous) => ({ ...previous, loading: false, error: String(error) }));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const stop = running ? startAdaptiveInterval(load, 5000, 15000) : undefined;
    return () => { cancelled = true; stop?.(); };
  }, [key, repositoryPath, parentSessionId, toolUseId, agentId, codex, running, fullHistory, revision]);
  return state.key === key ? state : { key, messages: [], loading: true, partial: false, error: "" };
}
