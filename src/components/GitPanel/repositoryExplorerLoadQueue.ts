type ExplorerLoadTask = () => Promise<void>;

let tail: Promise<void> = Promise.resolve();

/** Serialize background (session-restore) explorer IPC. */
export function enqueueExplorerLoad(task: ExplorerLoadTask): void {
  tail = tail.then(task).catch(() => undefined);
}

/** User expand/click — do not wait behind background restore queue. */
export function runExplorerUserLoad(task: ExplorerLoadTask): Promise<void> {
  return Promise.resolve().then(task);
}

/** Test helper */
export function resetExplorerLoadQueueForTests(): void {
  tail = Promise.resolve();
}
