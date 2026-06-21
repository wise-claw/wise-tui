import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  buildContextBreakdownSnapshot,
  getDefaultContextOverheadEstimate,
  loadContextOverheadEstimate,
  type ContextBreakdownSnapshot,
  type ContextOverheadEstimate,
} from "../services/claudeContextBreakdown";
import { getSessionContextMetrics } from "../services/claudeSessionContext";
import type { ClaudeSession } from "../types";
import {
  isComposerInteractionActive,
  subscribeComposerInteraction,
} from "../stores/composerInteractionGate";
import {
  isMainThreadCongested,
  subscribeMainThreadCongestion,
} from "../stores/mainThreadCongestionStore";
import { sessionContextRefreshFingerprint } from "../utils/sessionContextRefreshFingerprint";
import { shouldDeferNonCriticalUiWork } from "../utils/uiWorkDefer";
import { runWhenIdle } from "../utils/deferIdle";

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

function subscribeContextBreakdownDefer(onStoreChange: () => void): () => void {
  const unsubCongestion = subscribeMainThreadCongestion(onStoreChange);
  const unsubComposer = subscribeComposerInteraction(onStoreChange);
  return () => {
    unsubCongestion();
    unsubComposer();
  };
}

function isContextBreakdownDeferActive(): boolean {
  return shouldDeferNonCriticalUiWork();
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
  const congested = useSyncExternalStore(
    subscribeMainThreadCongestion,
    isMainThreadCongested,
    () => false,
  );
  const composerActive = useSyncExternalStore(
    subscribeComposerInteraction,
    isComposerInteractionActive,
    () => false,
  );
  const messageFingerprint = sessionContextRefreshFingerprint(session, {
    congested: congested || composerActive,
  });

  const applyQuickBreakdown = useCallback(() => {
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
  }, [repositoryPath]);

  useEffect(() => {
    requestIdRef.current += 1;
    setBreakdown(null);
    setLoading(false);
    overheadCacheRef.current = null;
    overheadResolvedRef.current = null;
  }, [session.id, repositoryPath]);

  useEffect(() => {
    if (isContextBreakdownDeferActive()) return;
    applyQuickBreakdown();
  }, [applyQuickBreakdown, messageFingerprint]);

  useEffect(() => {
    if (!isContextBreakdownDeferActive()) return;
    const cancel = runWhenIdle(() => {
      if (!isContextBreakdownDeferActive()) {
        applyQuickBreakdown();
      }
    }, { timeoutMs: 480 });
    return cancel;
  }, [applyQuickBreakdown, messageFingerprint, congested, composerActive]);

  useEffect(() => {
    return subscribeContextBreakdownDefer(() => {
      if (isContextBreakdownDeferActive()) return;
      applyQuickBreakdown();
    });
  }, [applyQuickBreakdown]);

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
