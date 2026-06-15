import { useEffect, useState } from "react";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { getClaudeLlmProxyStatus } from "../services/claudeLlmProxy";
import { getFreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { getOpencodeGoProxyStatus } from "../services/opencodeGoProxy";
import { resolveComposerActiveProxyLabel } from "../utils/composerActiveProxyLabel";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

const VISIBLE_POLL_MS = 5000;
const HIDDEN_POLL_MS = 15000;

/** Composer 底栏：当前会话实际经行的 Wise 内置代理名称（无代理时 null）。 */
export function useComposerActiveProxyLabel(
  engine: SessionExecutionEngine,
  repositoryPath?: string | null,
): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [ocgo, llm, fcc] = await Promise.all([
          getOpencodeGoProxyStatus(),
          getClaudeLlmProxyStatus(repositoryPath),
          getFreeClaudeCodeStatus(),
        ]);
        if (cancelled) return;
        setLabel(resolveComposerActiveProxyLabel(engine, ocgo, llm, fcc));
      } catch {
        if (!cancelled) {
          setLabel(null);
        }
      }
    };

    void refresh();
    const dispose = startAdaptiveInterval(() => void refresh(), VISIBLE_POLL_MS, HIDDEN_POLL_MS);
    return () => {
      cancelled = true;
      dispose();
    };
  }, [engine, repositoryPath]);

  return label;
}
