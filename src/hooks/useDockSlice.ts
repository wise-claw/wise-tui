import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ControlRequestStatus, SessionDockSlice } from "../notifications";
import { notificationHub } from "../notifications";

export interface DockSliceWithLifecycle extends SessionDockSlice {
  questionRequestStatus: ControlRequestStatus | null;
  questionRequestError: string | null;
  permissionRequestStatus: ControlRequestStatus | null;
  permissionRequestError: string | null;
}

function noopDockSubscribe(): () => void {
  return () => {};
}

/** 订阅指定会话 id 的通知桶（todo / 追问 / 权限等），用于双栏等多 `ClaudeChat` 场景。 */
export function useDockSlice(sessionId: string | null): DockSliceWithLifecycle {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionId) return noopDockSubscribe();
      return notificationHub.subscribeDockSlice(sessionId, onStoreChange);
    },
    [sessionId],
  );

  const getSnapshot = useCallback(() => {
    if (!sessionId) return 0;
    return notificationHub.getDockSliceGeneration(sessionId);
  }, [sessionId]);

  const dockGen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    if (!sessionId) {
      return {
        todos: [],
        followupItems: [],
        revertItems: [],
        questionRequest: null,
        questionRequestQueue: [],
        permissionRequest: null,
        questionRequestStatus: null,
        questionRequestError: null,
        permissionRequestStatus: null,
        permissionRequestError: null,
      };
    }
    void dockGen;
    const slice = notificationHub.getDockSlice(sessionId);
    const qr = slice.questionRequest;
    const pr = slice.permissionRequest;
    const questionRequestLifecycle = qr ? notificationHub.getRequestLifecycle(qr.id) : null;
    const permissionRequestLifecycle = pr ? notificationHub.getRequestLifecycle(pr.id) : null;
    return {
      ...slice,
      questionRequestStatus: questionRequestLifecycle?.status ?? null,
      questionRequestError: questionRequestLifecycle?.lastError ?? null,
      permissionRequestStatus: permissionRequestLifecycle?.status ?? null,
      permissionRequestError: permissionRequestLifecycle?.lastError ?? null,
    };
  }, [dockGen, sessionId]);
}
