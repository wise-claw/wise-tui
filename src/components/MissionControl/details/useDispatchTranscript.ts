import { useEffect, useState } from "react";
import { loadClaudeSessionJsonl } from "../../../services/claudeDisk";
import { readSnapshotFile } from "../../../services/materializePrdSnapshot";
import { parseClaudeSessionJsonlLines } from "../../../utils/claudeSessionJsonl";
import type { ClaudeMessage } from "../../../types";
import type { DispatchClusterRawOutput } from "../../../services/prdSplit/splitterDispatch";
import { messagesToSearchText, textMatchesDispatchNeedles } from "./dispatchSessionResolver";

interface DispatchTranscriptInput {
  open: boolean;
  raw: DispatchClusterRawOutput | null | undefined;
  liveStdoutLines: string[];
  repositoryPath?: string;
  sessionId?: string | null;
  fallbackSessionNeedles?: string[];
}

export interface DispatchTranscript {
  stdoutText: string;
  stderrText: string;
  resultText: string;
  diskMessages: ClaudeMessage[];
  source: "live" | "disk" | "claude-session" | "empty";
  loading: boolean;
}

export function useDispatchTranscript(input: DispatchTranscriptInput): DispatchTranscript {
  const [state, setState] = useState<DispatchTranscript>({
    stdoutText: "",
    stderrText: "",
    resultText: "",
    diskMessages: [],
    source: "empty",
    loading: false,
  });

  const liveStdout = input.liveStdoutLines.join("\n").trim();
  const raw = input.raw ?? null;
  const rawKey = [
    raw?.runId ?? "",
    raw?.stdoutPath ?? "",
    raw?.stderrPath ?? "",
    raw?.rawResultPath ?? "",
    raw?.claudeSessionId ?? "",
    input.repositoryPath ?? "",
    input.sessionId ?? "",
    ...(input.fallbackSessionNeedles ?? []),
  ].join("|");

  useEffect(() => {
    if (!input.open) {
      setState({
        stdoutText: "",
        stderrText: "",
        resultText: "",
        diskMessages: [],
        source: "empty",
        loading: false,
      });
      return;
    }

    let cancelled = false;
    const immediateSource = liveStdout ? "live" : "empty";
    setState((prev) => ({
      ...prev,
      stdoutText: liveStdout,
      source: immediateSource,
      loading: Boolean(raw || input.sessionId),
    }));

    if (!raw && !input.sessionId) return;

    void (async () => {
      const [stdoutText, stderrText, resultText, diskMessages] = await Promise.all([
        raw?.stdoutPath ? readSnapshotFile(raw.stdoutPath).catch(() => "") : Promise.resolve(""),
        raw?.stderrPath ? readSnapshotFile(raw.stderrPath).catch(() => "") : Promise.resolve(""),
        raw?.rawResultPath ? readSnapshotFile(raw.rawResultPath).catch(() => "") : Promise.resolve(""),
        loadDiskMessages({
          repositoryPath: input.repositoryPath,
          preferredSessionId: input.sessionId ?? raw?.claudeSessionId,
          fallbackSessionId: raw?.claudeSessionId,
          fallbackNeedles: input.fallbackSessionNeedles ?? [],
        }),
      ]);
      if (cancelled) return;
      const effectiveStdout = liveStdout || stdoutText.trim();
      setState({
        stdoutText: effectiveStdout,
        stderrText: stderrText.trim(),
        resultText: resultText.trim(),
        diskMessages,
        source: diskMessages.length > 0
          ? "claude-session"
          : effectiveStdout
            ? liveStdout ? "live" : "disk"
            : "empty",
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [input.open, liveStdout, raw, rawKey, input.repositoryPath, input.sessionId, input.fallbackSessionNeedles]);

  return state;
}

async function loadDiskMessages(input: {
  repositoryPath: string | undefined;
  preferredSessionId: string | null | undefined;
  fallbackSessionId: string | null | undefined;
  fallbackNeedles: string[];
}): Promise<ClaudeMessage[]> {
  const rp = input.repositoryPath?.trim();
  if (!rp) return [];

  const sessionIds = [
    input.preferredSessionId?.trim() ?? "",
    input.fallbackSessionId?.trim() ?? "",
  ].filter((sessionId, index, all) => sessionId && all.indexOf(sessionId) === index);

  for (const sessionId of sessionIds) {
    try {
      const lines = await loadClaudeSessionJsonl(rp, sessionId);
      const messages = parseClaudeSessionJsonlLines(lines);
      if (messages.length === 0) continue;
      if (input.fallbackNeedles.length === 0 || textMatchesDispatchNeedles(messagesToSearchText(messages), input.fallbackNeedles)) {
        return messages;
      }
    } catch {
      /* Try the next candidate. */
    }
  }

  return [];
}
