import { useEffect, useRef } from "react";
import type { ClaudeSession } from "../types";
import { reloadChromeDevtoolsMonitor } from "../services/chromeDevtoolsMonitor";
import { consumeCompletedPageMonitorReloads } from "../services/runtimeAutoFixDispatch";
import { notifyPageMonitorReloaded } from "../stores/chromeDevtoolsMonitorRuntimeStore";
import { subscribeClaudeSessionsStructure } from "../stores/claudeSessionsLiveStore";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

/**
 * When a page-monitor auto-fix worker settles to idle, reload the monitored page
 * so continuous monitoring can verify the fix.
 */
export function usePageMonitorAutoFixReload(input: {
  getSessions: () => readonly ClaudeSession[];
}): void {
  const getSessionsRef = useRef(input.getSessions);
  getSessionsRef.current = input.getSessions;
  const inFlightRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const scan = () => {
      if (cancelled) return;
      const toReload = consumeCompletedPageMonitorReloads(getSessionsRef.current());
      for (const sessionId of toReload) {
        if (inFlightRef.current.has(sessionId)) continue;
        inFlightRef.current.add(sessionId);
        void reloadChromeDevtoolsMonitor(sessionId)
          .then(() => {
            if (!cancelled) notifyPageMonitorReloaded(sessionId);
          })
          .catch(() => {
            /* ignore: monitor may have stopped */
          })
          .finally(() => {
            inFlightRef.current.delete(sessionId);
          });
      }
    };

    scan();
    const unsubscribe = subscribeClaudeSessionsStructure(scan);
    const stopPoll = startAdaptiveInterval(scan, 2500, 10000);
    return () => {
      cancelled = true;
      unsubscribe();
      stopPoll();
    };
  }, []);
}
