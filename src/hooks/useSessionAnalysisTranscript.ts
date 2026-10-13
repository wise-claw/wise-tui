import { useCallback, useEffect, useState } from "react";
import type { ClaudeSession } from "../types";
import { loadSessionAnalysisTranscript, sessionAnalysisTranscriptTarget } from "../services/sessionAnalysisTranscript";

/** Both analysis surfaces use the execution engine's own transcript and discard stale loads. */
export function useSessionAnalysisTranscript(session: ClaudeSession | null, active: boolean, load = loadSessionAnalysisTranscript) {
  const target = sessionAnalysisTranscriptTarget(session);
  const key = target ? `${session?.id}:${target.source}:${target.repositoryPath}:${target.key}` : '';
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{ key: string; lines: string[] | null; loading: boolean; error: string | null }>({ key: '', lines: null, loading: false, error: null });
  const tailLines = session?.diskTranscriptPartial || (session?.messages.length ?? 0) < 80 ? 8000 : 1200;
  const status = session?.status;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!active || !target) return;
    let cancelled = false;
    setData(previous => ({ key, lines: previous.key === key ? previous.lines : null, loading: true, error: null }));
    void load(target, tailLines).then(lines => {
      if (!cancelled) setData({ key, lines, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setData(previous => ({ key, lines: previous.key === key ? previous.lines : null, loading: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return () => { cancelled = true; };
  }, [key, active, revision, status, tailLines, load]);
  const current = data.key === key;
  return { canLoadDisk: Boolean(target), lines: current ? data.lines : null, loading: active && Boolean(target) && (!current || data.loading), error: current ? data.error : null, refresh };
}
