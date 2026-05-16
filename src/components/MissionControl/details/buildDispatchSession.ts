import type { ClaudeMessage, ClaudeSession } from "../../../types";
import { parseClaudeSessionJsonlLines } from "../../../utils/claudeSessionJsonl";

/**
 * Build a synthetic ClaudeSession from dispatch output so it can be rendered
 * by the existing ClaudeSessionMessagesColumn.
 *
 * Raw stdout is parsed through parseClaudeSessionJsonlLines so tool calls
 * (Bash, Edit, Read, etc.) get the same rich rendering as main chat messages.
 */
export function buildDispatchSession(params: {
  clusterId: string;
  clusterTitle: string;
  repoPath: string;
  repoName: string;
  claudeSessionId?: string | null;
  stdout: string;
  stderr?: string;
  result?: string;
  diskMessages?: ClaudeMessage[];
  isRunning: boolean;
}): ClaudeSession {
  const now = Date.now();
  const diskMessages = params.diskMessages ?? [];
  const promptText = `派发子代理 trellis-splitter\n任务分组: ${params.clusterTitle}\nCluster: ${params.clusterId}`;

  // Prefer disk messages (already parsed from JSONL)
  if (diskMessages.length > 0) {
    return {
      id: `dispatch-${params.clusterId}-${now}`,
      claudeSessionId: params.claudeSessionId?.trim() || null,
      repositoryPath: params.repoPath,
      repositoryName: params.repoName,
      model: "",
      status: params.isRunning ? "running" : "completed",
      createdAt: now,
      pendingPrompt: "",
      messages: diskMessages.map((m, idx) => ({ ...m, id: idx + 1 })),
    };
  }

  // Parse stdout as stream-json to get structured messages
  const messages = parseStdoutToMessages(params.stdout, promptText, now);

  return {
    id: `dispatch-${params.clusterId}-${now}`,
    claudeSessionId: params.claudeSessionId?.trim() || null,
    repositoryPath: params.repoPath,
    repositoryName: params.repoName,
    model: "",
    status: params.isRunning ? "running" : "completed",
    createdAt: now,
    pendingPrompt: "",
    messages,
  };
}

/**
 * Parse raw Claude stdout (stream-json / JSONL) into structured ClaudeMessage[].
 * Falls back to a single text block if parsing yields no messages.
 */
function parseStdoutToMessages(
  stdout: string,
  promptText: string,
  now: number,
): ClaudeMessage[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return waitingMessage(promptText, now);
  }

  const lines = trimmed.split("\n");
  try {
    const parsed = parseClaudeSessionJsonlLines(lines);
    if (parsed.length > 0) return reindexMessages(parsed);
  } catch {
    // Fall through to raw text rendering
  }

  // Fallback: show as raw text
  return [
    {
      id: 1,
      role: "user",
      content: promptText,
      parts: [{ type: "text", text: promptText }],
      timestamp: now - 1000,
    },
    {
      id: 2,
      role: "assistant" as const,
      content: trimmed,
      parts: [{ type: "text" as const, text: trimmed }],
      timestamp: now,
    },
  ];
}

function waitingMessage(promptText: string, now: number): ClaudeMessage[] {
  return [
    {
      id: 1,
      role: "user",
      content: promptText,
      parts: [{ type: "text", text: promptText }],
      timestamp: now - 1000,
    },
    {
      id: 2,
      role: "assistant" as const,
      content: "等待子代理输出…",
      parts: [{ type: "text" as const, text: "等待子代理输出…" }],
      timestamp: now,
    },
  ];
}

function reindexMessages(messages: ClaudeMessage[]): ClaudeMessage[] {
  return messages.map((m, idx) => ({ ...m, id: idx + 1 }));
}
