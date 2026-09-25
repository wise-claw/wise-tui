import { useCallback, useEffect, useRef, useState } from "react";
import { getCollabRequirementSnapshot, normalizeCollabError, onCollabChanged } from "../services/collaboration";
import type { CollabError, CollabRequirementSnapshot } from "../types/collaboration";

const REFRESH_DEBOUNCE_MS = 400;

/** 订阅单条协作需求快照：Rust 写入该需求（或全局变更）后去抖刷新。 */
export function useCollabRequirementSnapshot(requirementId: string | null): {
  snapshot: CollabRequirementSnapshot | null;
  error: CollabError | null;
  loading: boolean;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<CollabRequirementSnapshot | null>(null);
  const [error, setError] = useState<CollabError | null>(null);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    if (!requirementId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    getCollabRequirementSnapshot(requirementId)
      .then((s) => {
        if (seq !== seqRef.current) return;
        setSnapshot(s);
        setError(null);
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        setError(normalizeCollabError(e));
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [requirementId]);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!requirementId) return;
    load();
    let timer: number | null = null;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onCollabChanged((id) => {
      if (id !== null && id !== requirementId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(load, REFRESH_DEBOUNCE_MS);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [load, requirementId]);

  return { snapshot, error, loading, reload: load };
}
