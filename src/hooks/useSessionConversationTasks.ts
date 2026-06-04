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
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  subscribeExecutionEnvironmentDispatches,
} from "../stores/executionEnvironmentDispatchStore";
import {
  anchorSessionConversationTasksFingerprint,
  buildSessionConversationTasks,
  executionEnvironmentWorkerSessionsFingerprint,
} from "../utils/sessionConversationTasks";
import { useExecutionEnvironmentDispatchPersistence } from "./useExecutionEnvironmentDispatchPersistence";

export function useSessionConversationTasks(
  activeSessionId: string | null | undefined,
  sessions: ClaudeSession[],
): SessionConversationTaskItem[] {
  useExecutionEnvironmentDispatchPersistence(activeSessionId);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const workerSessionsFingerprint = useMemo(
    () => executionEnvironmentWorkerSessionsFingerprint(sessions),
    [sessions],
  );

  const anchorSessionFingerprint = useMemo(() => {
    const session = activeSessionId
      ? sessionsRef.current.find((item) => item.id === activeSessionId) ?? null
      : null;
    return anchorSessionConversationTasksFingerprint(session);
  }, [activeSessionId, workerSessionsFingerprint]);

  const activeSessionRepositoryPath = useMemo(() => {
    if (!activeSessionId) return "";
    return (
      sessionsRef.current.find((item) => item.id === activeSessionId)?.repositoryPath?.trim() ?? ""
    );
  }, [activeSessionId, workerSessionsFingerprint]);

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
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(activeSessionId),
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(activeSessionId),
  );

  const [bundleSnapshots, setBundleSnapshots] = useState<BackgroundInvocationSnapshot[]>([]);

  useEffect(() => {
    if (!activeSessionId || !activeSessionRepositoryPath) {
      setBundleSnapshots([]);
      return;
    }
    const sessionId = activeSessionId;
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
  }, [activeSessionId, activeSessionRepositoryPath]);

  return useMemo(() => {
    const session = activeSessionId
      ? sessionsRef.current.find((item) => item.id === activeSessionId) ?? null
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
    activeSessionId,
    anchorSessionFingerprint,
    activeSessionRepositoryPath,
    directBatchInvocations,
    repositoryInvocations,
    bundleSnapshots,
    executionEnvironmentRecords,
    workerSessionsFingerprint,
  ]);
}
