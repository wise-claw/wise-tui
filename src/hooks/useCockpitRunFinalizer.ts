import { useEffect } from "react";
import {
  getClaudeSessionsSnapshot,
  subscribeClaudeSessionsStructure,
} from "../stores/claudeSessionsLiveStore";
import { hydrateCockpitConversations } from "../services/cockpitConversationStore";
import { finalizeCockpitRunsFromSessions } from "../services/cockpitBriefDispatch";

/** 会话结构变化时，把 Cockpit Brief 运行收口为完成/失败，并挂上当时的仓库改动。 */
export function useCockpitRunFinalizer(): void {
  useEffect(() => {
    let cancelled = false;
    void hydrateCockpitConversations();
    const tick = () => {
      if (cancelled) return;
      void finalizeCockpitRunsFromSessions(getClaudeSessionsSnapshot());
    };
    tick();
    const unsubscribe = subscribeClaudeSessionsStructure(tick);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
