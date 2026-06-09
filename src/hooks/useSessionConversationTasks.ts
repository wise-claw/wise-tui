import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  type BackgroundInvocationBundleChangedDetail,
} from "../constants/workflowUiEvents";
import { readInvocationSnapshotBundle } from "../services/backgroundInvocationSnapshot";
import type { BackgroundInvocationSnapshot } from "../services/backgroundInvocationSnapshot";

/** 会话任务列表仅需快照元数据，不必把 stdout/stderr 大数组常驻 React state。 */
function bundleSnapshotsForConversationTasks(
  items: Record<string, BackgroundInvocationSnapshot>,
): BackgroundInvocationSnapshot[] {
  return Object.values(items).map((snap) => ({
    invocationKey: snap.invocationKey,
    taskId: snap.taskId,
    templateId: snap.templateId,
    attempt: snap.attempt,
    phase: snap.phase,
    success: snap.success,
    lineCount: snap.lineCount,
    errCount: snap.errCount,
    previewLine: snap.previewLine,
    dispatchPrompt: snap.dispatchPrompt,
    updatedAt: snap.updatedAt,
    stdoutLines: [],
    stderrLines: [],
  }));
}
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../stores/omcDirectBatchInvocationsStore";
import {
  getRepositoryMemberInvocationsSnapshot,
  subscribeRepositoryMemberInvocations,
} from "../stores/repositoryMemberInvocationsStore";
import type { ClaudeSession, Repository, SessionConversationTaskItem } from "../types";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  subscribeExecutionEnvironmentDispatches,
} from "../stores/executionEnvironmentDispatchStore";
import {
  anchorSessionConversationTasksFingerprint,
  buildSessionConversationTasks,
  executionEnvironmentWorkerSessionsFingerprint,
  sessionsReactiveStructureKey,
} from "../utils/sessionConversationTasks";
import { resolveExecutionEnvironmentDispatchAnchorSessionId } from "../utils/executionEnvironmentDispatchAnchor";
import { useExecutionEnvironmentDispatchPersistence } from "./useExecutionEnvironmentDispatchPersistence";

export function useSessionConversationTasks(
  activeSessionId: string | null | undefined,
  sessions: ClaudeSession[],
  options?: {
    repositoryMainSessionBindings?: Record<string, string>;
    repositories?: readonly Repository[];
  },
): SessionConversationTaskItem[] {
  const repositoryMainSessionBindings = options?.repositoryMainSessionBindings ?? {};
  const repositories = options?.repositories ?? [];

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const sessionsStructureKey = sessionsReactiveStructureKey(sessions);

  const dispatchAnchorSessionId = useMemo(
    () =>
      resolveExecutionEnvironmentDispatchAnchorSessionId({
        activeSessionId,
        sessions: sessionsRef.current,
        repositoryMainSessionBindings,
        repositories,
      }),
    [activeSessionId, repositoryMainSessionBindings, repositories, sessionsStructureKey],
  );

  useExecutionEnvironmentDispatchPersistence(
    activeSessionId,
    sessions,
    repositoryMainSessionBindings,
    repositories,
  );

  const workerSessionsFingerprint = useMemo(
    () => executionEnvironmentWorkerSessionsFingerprint(sessionsRef.current),
    [sessionsStructureKey],
  );

  const anchorSessionFingerprint = useMemo(() => {
    const session = dispatchAnchorSessionId
      ? sessionsRef.current.find((item) => item.id === dispatchAnchorSessionId) ?? null
      : null;
    return anchorSessionConversationTasksFingerprint(session);
  }, [dispatchAnchorSessionId, sessionsStructureKey]);

  const activeSessionRepositoryPath = useMemo(() => {
    if (!dispatchAnchorSessionId) return "";
    return (
      sessionsRef.current.find((item) => item.id === dispatchAnchorSessionId)?.repositoryPath?.trim() ??
      ""
    );
  }, [dispatchAnchorSessionId, sessionsStructureKey]);

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
  const executionEnvironmentRecords = useSyncExternalStore(
    subscribeExecutionEnvironmentDispatches,
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(dispatchAnchorSessionId),
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(dispatchAnchorSessionId),
  );

  const [bundleSnapshots, setBundleSnapshots] = useState<BackgroundInvocationSnapshot[]>([]);

  useEffect(() => {
    if (!dispatchAnchorSessionId || !activeSessionRepositoryPath) {
      setBundleSnapshots([]);
      return;
    }
    const sessionId = dispatchAnchorSessionId;
    const repositoryPath = activeSessionRepositoryPath;
    let cancelled = false;
    const load = async () => {
      const bundle = await readInvocationSnapshotBundle(sessionId, repositoryPath);
      if (cancelled) return;
      setBundleSnapshots(bundleSnapshotsForConversationTasks(bundle.items));
    };
    void load();

    const onBundleChanged = (event: Event) => {
      const detail = (event as CustomEvent<BackgroundInvocationBundleChangedDetail>).detail;
      if (!detail) return;
      if (detail.sessionId !== sessionId || detail.repositoryPath !== repositoryPath) return;
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
  }, [dispatchAnchorSessionId, activeSessionRepositoryPath]);

  return useMemo(() => {
    const session = dispatchAnchorSessionId
      ? sessionsRef.current.find((item) => item.id === dispatchAnchorSessionId) ?? null
      : null;
    return buildSessionConversationTasks({
      session,
      directBatchInvocations,
      repositoryInvocations,
      bundleSnapshots,
      executionEnvironmentRecords,
      allSessions: sessionsRef.current,
    });
  }, [
    dispatchAnchorSessionId,
    anchorSessionFingerprint,
    activeSessionRepositoryPath,
    directBatchInvocations,
    repositoryInvocations,
    bundleSnapshots,
    executionEnvironmentRecords,
    workerSessionsFingerprint,
  ]);
}
