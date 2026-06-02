/** 顶栏用量 Popover ↔ 全链路洞察 互跳请求（轻量 external store）。 */

export type SessionDataLinkOpenView = "list" | "diagram" | "insights";

type Snapshot = {
  usagePopoverOpenNonce: number;
  sessionDataLinkOpenNonce: number;
  sessionDataLinkInitialView: SessionDataLinkOpenView;
};

let snapshot: Snapshot = {
  usagePopoverOpenNonce: 0,
  sessionDataLinkOpenNonce: 0,
  sessionDataLinkInitialView: "insights",
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeClaudeUsageUiStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClaudeUsageUiStoreSnapshot(): Snapshot {
  return snapshot;
}

export function requestOpenUsagePopover(): void {
  snapshot = { ...snapshot, usagePopoverOpenNonce: snapshot.usagePopoverOpenNonce + 1 };
  emit();
}

export function requestOpenSessionDataLink(view: SessionDataLinkOpenView = "insights"): void {
  snapshot = {
    ...snapshot,
    sessionDataLinkOpenNonce: snapshot.sessionDataLinkOpenNonce + 1,
    sessionDataLinkInitialView: view,
  };
  emit();
}

export function consumeSessionDataLinkOpenRequest(): SessionDataLinkOpenView | null {
  return snapshot.sessionDataLinkOpenNonce > 0 ? snapshot.sessionDataLinkInitialView : null;
}
