import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import {
  digestOmcDirectBatchInvocationsList,
  sortOmcDirectBatchInvocationsForStore,
  MAX_PERSISTED_OMC_DIRECT_BATCH_ITEMS,
} from "../services/omcDirectBatchInvocationsPersistence";
import { isOmcDirectBatchInvocationRunning } from "../utils/omcDirectBatchInvocationDisplay";

type Listener = () => void;

const listeners = new Set<Listener>();

/** 与 digest 对应的列表；仅 digest 变化时替换引用，便于 useSyncExternalStore 去重 */
let snapshot: WorkflowInvocationStreamDetail[] = [];
let snapshotDigest = "";
let snapshotPipelineBusy = false;

function recomputeSnapshotPipelineBusy(): boolean {
  return snapshot.some(isOmcDirectBatchInvocationRunning);
}

export function getOmcDirectBatchInvocationsSnapshot(): WorkflowInvocationStreamDetail[] {
  return snapshot;
}

export function getOmcDirectBatchInvocationsDigest(): string {
  return snapshotDigest;
}

/** 供 useSyncExternalStore：仅布尔值，避免列表引用变化导致 ClaudeChat 每帧重渲。 */
export function getOmcDirectBatchPipelineBusySnapshot(): boolean {
  return snapshotPipelineBusy;
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
  const capped = sortOmcDirectBatchInvocationsForStore(list).slice(-MAX_PERSISTED_OMC_DIRECT_BATCH_ITEMS);
  const cappedDigest =
    capped.length === list.length ? digest : digestOmcDirectBatchInvocationsList(capped);
  if (cappedDigest === snapshotDigest) {
    return;
  }
  snapshotDigest = cappedDigest;
  snapshot = capped;
  snapshotPipelineBusy = recomputeSnapshotPipelineBusy();
  notify();
}

export function resetOmcDirectBatchInvocationsStore(): void {
  if (snapshot.length === 0 && snapshotDigest === "") {
    return;
  }
  snapshotDigest = "";
  snapshot = [];
  snapshotPipelineBusy = false;
  notify();
}
