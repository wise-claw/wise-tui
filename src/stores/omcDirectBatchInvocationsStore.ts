import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";

type Listener = () => void;

const listeners = new Set<Listener>();

/** 与 digest 对应的列表；仅 digest 变化时替换引用，便于 useSyncExternalStore 去重 */
let snapshot: WorkflowInvocationStreamDetail[] = [];
let snapshotDigest = "";

export function getOmcDirectBatchInvocationsSnapshot(): WorkflowInvocationStreamDetail[] {
  return snapshot;
}

export function subscribeOmcDirectBatchInvocations(listener: Listener): () => void {
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

/**
 * 直连批量 OMC 的 invocation 列表仅由此更新；勿在 React 根上 setState，否则会与高频 progress 叠加导致整应用卡死。
 */
export function setOmcDirectBatchInvocationsStore(list: WorkflowInvocationStreamDetail[], digest: string): void {
  if (digest === snapshotDigest) {
    return;
  }
  snapshotDigest = digest;
  snapshot = list;
  notify();
}

export function resetOmcDirectBatchInvocationsStore(): void {
  if (snapshot.length === 0 && snapshotDigest === "") {
    return;
  }
  snapshotDigest = "";
  snapshot = [];
  notify();
}
