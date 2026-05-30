import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildContextBreakdownSnapshot,
  getDefaultContextOverheadEstimate,
  loadContextOverheadEstimate,
  type ContextBreakdownSnapshot,
  type ContextOverheadEstimate,
} from "../services/claudeContextBreakdown";
import { getSessionContextMetrics } from "../services/claudeSessionContext";
import type { ClaudeSession } from "../types";

function buildSnapshot(
  session: ClaudeSession,
  overhead: ContextOverheadEstimate,
): ContextBreakdownSnapshot {
  const metrics = getSessionContextMetrics(session);
  return buildContextBreakdownSnapshot(session, overhead, metrics);
}

export function useContextBreakdown(session: ClaudeSession) {
  const [breakdown, setBreakdown] = useState<ContextBreakdownSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const overheadCacheRef = useRef<{
    repositoryPath: string;
    promise: ReturnType<typeof loadContextOverheadEstimate>;
  } | null>(null);
  const overheadResolvedRef = useRef<{
    repositoryPath: string;
    value: ContextOverheadEstimate;
  } | null>(null);

  const repositoryPath = session.repositoryPath.trim();
  const messageFingerprint = useMemo(() => {
    const last = session.messages[session.messages.length - 1];
    return `${session.messages.length}:${last?.id ?? ""}:${String(last?.content ?? "").length}`;
  }, [session.messages]);

  useEffect(() => {
    requestIdRef.current += 1;
    setBreakdown(null);
    setLoading(false);
    overheadCacheRef.current = null;
    overheadResolvedRef.current = null;
  }, [session.id, repositoryPath]);

  useEffect(() => {
    const cachedOverhead =
      overheadResolvedRef.current?.repositoryPath === repositoryPath
        ? overheadResolvedRef.current.value
        : getDefaultContextOverheadEstimate();
    setBreakdown(buildSnapshot(session, cachedOverhead));
  }, [messageFingerprint, repositoryPath, session]);

  const ensureBreakdown = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const cachedOverhead =
      overheadResolvedRef.current?.repositoryPath === repositoryPath
        ? overheadResolvedRef.current.value
        : getDefaultContextOverheadEstimate();
    setBreakdown(buildSnapshot(session, cachedOverhead));
    setLoading(
      !overheadResolvedRef.current || overheadResolvedRef.current.repositoryPath !== repositoryPath,
    );

    try {
      if (!overheadCacheRef.current || overheadCacheRef.current.repositoryPath !== repositoryPath) {
        overheadCacheRef.current = {
          repositoryPath,
          promise: loadContextOverheadEstimate(repositoryPath),
        };
      }
      const overhead = await overheadCacheRef.current.promise;
      overheadResolvedRef.current = { repositoryPath, value: overhead };
      if (requestIdRef.current !== requestId) return;
      setBreakdown(buildSnapshot(session, overhead));
    } catch {
      if (requestIdRef.current !== requestId) return;
      setBreakdown(buildSnapshot(session, cachedOverhead));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [repositoryPath, session]);

  return { breakdown, loading, ensureBreakdown };
}
