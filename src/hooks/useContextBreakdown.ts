import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildContextBreakdownSnapshot,
  loadContextOverheadEstimate,
  type ContextBreakdownSnapshot,
} from "../services/claudeContextBreakdown";
import { getSessionContextMetrics } from "../services/claudeSessionContext";
import type { ClaudeSession } from "../types";

export function useContextBreakdown(session: ClaudeSession) {
  const [breakdown, setBreakdown] = useState<ContextBreakdownSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const overheadCacheRef = useRef<{
    repositoryPath: string;
    promise: ReturnType<typeof loadContextOverheadEstimate>;
  } | null>(null);

  const repositoryPath = session.repositoryPath.trim();

  useEffect(() => {
    requestIdRef.current += 1;
    setBreakdown(null);
    setLoading(false);
    overheadCacheRef.current = null;
  }, [session.id, repositoryPath, session.messages]);

  const ensureBreakdown = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      if (!overheadCacheRef.current || overheadCacheRef.current.repositoryPath !== repositoryPath) {
        overheadCacheRef.current = {
          repositoryPath,
          promise: loadContextOverheadEstimate(repositoryPath),
        };
      }
      const overhead = await overheadCacheRef.current.promise;
      if (requestIdRef.current !== requestId) return;
      const metrics = getSessionContextMetrics(session);
      setBreakdown(buildContextBreakdownSnapshot(session, overhead, metrics));
    } catch {
      if (requestIdRef.current !== requestId) return;
      setBreakdown(null);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [repositoryPath, session]);

  return { breakdown, loading, ensureBreakdown };
}
