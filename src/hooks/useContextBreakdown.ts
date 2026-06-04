import { useCallback, useEffect, useRef, useState } from "react";
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

function contextBreakdownFingerprint(snapshot: ContextBreakdownSnapshot): string {
  return [
    snapshot.totalTokens,
    snapshot.ctxPercent,
    snapshot.maxTokens,
    ...snapshot.categories.map((c) => `${c.id}:${c.tokens}`),
  ].join("|");
}

/** 流式正文按长度分桶，避免每个 token 触发 effect。 */
function sessionMessagesBreakdownFingerprint(session: ClaudeSession): string {
  const last = session.messages[session.messages.length - 1];
  const previewBucket =
    last?.content && last.content.length > 0 ? Math.floor(last.content.length / 280) : 0;
  const partsLen =
    last?.parts?.reduce((sum, part) => {
      if (part.type === "text" || part.type === "reasoning") return sum + part.text.length;
      return sum;
    }, 0) ?? 0;
  const partsBucket = partsLen > 0 ? Math.floor(partsLen / 280) : 0;
  return `${session.messages.length}:${last?.id ?? ""}:${last?.role ?? ""}:${previewBucket}:${partsBucket}`;
}

export function useContextBreakdown(session: ClaudeSession) {
  const [breakdown, setBreakdown] = useState<ContextBreakdownSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const overheadCacheRef = useRef<{
    repositoryPath: string;
    promise: ReturnType<typeof loadContextOverheadEstimate>;
  } | null>(null);
  const overheadResolvedRef = useRef<{
    repositoryPath: string;
    value: ContextOverheadEstimate;
  } | null>(null);

  const repositoryPath = session.repositoryPath.trim();
  const messageFingerprint = sessionMessagesBreakdownFingerprint(session);

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
    const next = buildSnapshot(sessionRef.current, cachedOverhead);
    setBreakdown((prev) => {
      if (prev && contextBreakdownFingerprint(prev) === contextBreakdownFingerprint(next)) {
        return prev;
      }
      return next;
    });
  }, [messageFingerprint, repositoryPath]);

  const ensureBreakdown = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const liveSession = sessionRef.current;

    const cachedOverhead =
      overheadResolvedRef.current?.repositoryPath === repositoryPath
        ? overheadResolvedRef.current.value
        : getDefaultContextOverheadEstimate();
    const quick = buildSnapshot(liveSession, cachedOverhead);
    setBreakdown((prev) => {
      if (prev && contextBreakdownFingerprint(prev) === contextBreakdownFingerprint(quick)) {
        return prev;
      }
      return quick;
    });
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
      const refined = buildSnapshot(sessionRef.current, overhead);
      setBreakdown((prev) => {
        if (prev && contextBreakdownFingerprint(prev) === contextBreakdownFingerprint(refined)) {
          return prev;
        }
        return refined;
      });
    } catch {
      if (requestIdRef.current !== requestId) return;
      setBreakdown((prev) => {
        if (prev && contextBreakdownFingerprint(prev) === contextBreakdownFingerprint(quick)) {
          return prev;
        }
        return quick;
      });
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [repositoryPath]);

  return { breakdown, loading, ensureBreakdown };
}
