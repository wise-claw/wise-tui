import { useCallback, useEffect, useRef, useState } from "react";
import { getCollabAgent, normalizeCollabError, onCollabChanged } from "../services/collaboration";
import type { CollabAgentBinding, CollabAgentProfile, CollabAgentRevision, CollabError } from "../types/collaboration";

export interface CollabAgentState {
  profile: CollabAgentProfile;
  bindings: CollabAgentBinding[];
  activeRevision: CollabAgentRevision | null;
}

/** 单个仓库智能体详情；智能体类变更（requirementId 为空）时刷新。 */
export function useCollabAgent(agentId: string | null): {
  data: CollabAgentState | null;
  error: CollabError | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<CollabAgentState | null>(null);
  const [error, setError] = useState<CollabError | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!agentId) return;
    const s = ++seq.current;
    try {
      const next = await getCollabAgent(agentId);
      if (s === seq.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (s === seq.current) setError(normalizeCollabError(e));
    }
  }, [agentId]);

  useEffect(() => {
    setData(null);
    if (!agentId) return;
    void reload();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onCollabChanged((rid) => {
      if (rid === null) void reload();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [agentId, reload]);

  return { data, error, reload };
}
