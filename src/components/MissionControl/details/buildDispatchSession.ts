import type { ClaudeMessage, ClaudeSession } from "../../../types";

/**
 * Build a synthetic ClaudeSession from dispatch output so it can be rendered
 * by the existing ClaudeSessionMessagesColumn.
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
  const stdoutText = params.stdout.trim();
  const stderrText = params.stderr?.trim() ?? "";
  const resultText = params.result?.trim() ?? "";
  const promptText = `派发子代理 trellis-splitter\n任务分组: ${params.clusterTitle}\nCluster: ${params.clusterId}`;
  const fallbackText = [
    stdoutText ? `Claude stdout\n${stdoutText}` : "",
    stderrText ? `Claude stderr\n${stderrText}` : "",
    resultText && resultText !== stdoutText ? `Raw result\n${resultText}` : "",
  ].filter(Boolean).join("\n\n") || "等待输出…";

  return {
    id: `dispatch-${params.clusterId}-${now}`,
    claudeSessionId: params.claudeSessionId?.trim() || null,
    repositoryPath: params.repoPath,
    repositoryName: params.repoName,
    model: "",
    status: params.isRunning ? "running" : "completed",
    createdAt: now,
    pendingPrompt: "",
    messages:
      diskMessages.length > 0
        ? diskMessages.map((message, index) => ({ ...message, id: index + 1 }))
        : [
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
              content: fallbackText,
              parts: [{ type: "text" as const, text: fallbackText }],
              timestamp: now,
            },
          ],
  };
}
