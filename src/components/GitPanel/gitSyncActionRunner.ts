import type { Dispatch, MutableRefObject, SetStateAction } from "react";

export type GitSyncActionKind = "fetch" | "pull" | "push";

export interface RunGitSyncOptions {
  kind: GitSyncActionKind;
  activeKindRef: MutableRefObject<GitSyncActionKind | null>;
  runningActions: MutableRefObject<Set<string>>;
  setLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  beginGitSyncOperation: () => void;
  endGitSyncOperation: () => void;
  refresh: () => Promise<void>;
  work: () => Promise<void>;
  onError?: (message: string) => void;
  onSuccess?: () => void;
}

/** 单仓库 Git 同步：首击即 loading，操作完成后再结束；同仓串行、不吞点击反馈。 */
export async function runGitSyncAction(options: RunGitSyncOptions): Promise<boolean> {
  const {
    kind,
    activeKindRef,
    runningActions,
    setLoading,
    beginGitSyncOperation,
    endGitSyncOperation,
    refresh,
    work,
    onError,
    onSuccess,
  } = options;

  if (activeKindRef.current !== null || runningActions.current.has(kind)) {
    return false;
  }

  activeKindRef.current = kind;
  runningActions.current.add(kind);
  setLoading((prev) => ({ ...prev, [kind]: true }));
  beginGitSyncOperation();

  try {
    await work();
    await refresh();
    onSuccess?.();
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onError?.(msg);
    return false;
  } finally {
    if (activeKindRef.current === kind) {
      activeKindRef.current = null;
    }
    runningActions.current.delete(kind);
    setLoading((prev) => ({ ...prev, [kind]: false }));
    endGitSyncOperation();
  }
}
