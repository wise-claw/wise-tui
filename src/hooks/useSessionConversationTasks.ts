import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  type BackgroundInvocationBundleChangedDetail,
} from "../constants/workflowUiEvents";
import { readInvocationSnapshotBundle } from "../services/backgroundInvocationSnapshot";
import type { BackgroundInvocationSnapshot } from "../services/backgroundInvocationSnapshot";
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../stores/omcDirectBatchInvocationsStore";
import {
  getRepositoryMemberInvocationsSnapshot,
  subscribeRepositoryMemberInvocations,
} from "../stores/repositoryMemberInvocationsStore";
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import { buildSessionConversationTasks } from "../utils/sessionConversationTasks";

export function useSessionConversationTasks(
  activeSessionId: string | null | undefined,
  sessions: ClaudeSession[],
): SessionConversationTaskItem[] {
  const session = useMemo(
    () => (activeSessionId ? sessions.find((item) => item.id === activeSessionId) ?? null : null),
    [activeSessionId, sessions],
  );

  const directBatchInvocations = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  const repositoryInvocations = useSyncExternalStore(
    subscribeRepositoryMemberInvocations,
    getRepositoryMemberInvocationsSnapshot,
    getRepositoryMemberInvocationsSnapshot,
  );

  const [bundleSnapshots, setBundleSnapshots] = useState<BackgroundInvocationSnapshot[]>([]);

  useEffect(() => {
    if (!session?.id || !session.repositoryPath?.trim()) {
      setBundleSnapshots([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const bundle = await readInvocationSnapshotBundle(session.id, session.repositoryPath);
      if (cancelled) return;
      setBundleSnapshots(Object.values(bundle.items));
    };
    void load();

    const onBundleChanged = (event: Event) => {
      const detail = (event as CustomEvent<BackgroundInvocationBundleChangedDetail>).detail;
      if (!detail) return;
      if (detail.sessionId !== session.id || detail.repositoryPath !== session.repositoryPath) return;
      void load();
    };
    window.addEventListener(WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED, onBundleChanged as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(
        WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
        onBundleChanged as EventListener,
      );
    };
  }, [session?.id, session?.repositoryPath]);

  return useMemo(
    () =>
      buildSessionConversationTasks({
        session,
        directBatchInvocations,
        repositoryInvocations,
        bundleSnapshots,
      }),
    [session, directBatchInvocations, repositoryInvocations, bundleSnapshots],
  );
}
