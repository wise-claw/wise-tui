import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import {
  capWorkflowInvocationStreamDetailsForMemory,
  MAX_REPOSITORY_MEMBER_INVOCATIONS_IN_MEMORY,
} from "../services/omcDirectBatchInvocationsPersistence";

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: WorkflowInvocationStreamDetail[] = [];
let snapshotDigest = "";

export function getRepositoryMemberInvocationsSnapshot(): WorkflowInvocationStreamDetail[] {
  return snapshot;
}

export function subscribeRepositoryMemberInvocations(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function digestRepositoryMemberInvocations(list: WorkflowInvocationStreamDetail[]): string {
  return list
    .map((item) =>
      [
        item.invocationKey,
        item.phase,
        item.templateId ?? "",
        item.ownerRepositoryId ?? "",
        item.stage ?? "",
        item.subagentType ?? "",
        item.lineCount ?? 0,
        item.errCount ?? 0,
        item.success ?? "",
      ].join("\t"),
    )
    .join("\n");
}

export function setRepositoryMemberInvocationsStore(list: WorkflowInvocationStreamDetail[], digest: string): void {
  const capped = capWorkflowInvocationStreamDetailsForMemory(
    list,
    MAX_REPOSITORY_MEMBER_INVOCATIONS_IN_MEMORY,
  );
  const cappedDigest =
    capped.length === list.length ? digest : digestRepositoryMemberInvocations(capped);
  if (cappedDigest === snapshotDigest) return;
  snapshotDigest = cappedDigest;
  snapshot = capped;
  notify();
}

export function resetRepositoryMemberInvocationsStore(): void {
  if (snapshot.length === 0 && snapshotDigest === "") return;
  snapshotDigest = "";
  snapshot = [];
  notify();
}
