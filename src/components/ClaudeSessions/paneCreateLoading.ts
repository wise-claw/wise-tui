import { message } from "antd";
import type { Dispatch, SetStateAction } from "react";

export const PANE_CREATE_MIN_LOADING_MS = 220;
export const PANE_CREATE_TIMEOUT_MS = 30_000;

async function withMinDuration<T>(task: Promise<T>, minMs: number): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task;
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, minMs - elapsed);
      });
    }
  }
}

export interface PaneCreateTaskOptions {
  minLoadingMs?: number;
  timeoutMs?: number;
}

/** 窗格创建 loading：最短展示 + 超时自动解除，避免 IPC 挂起导致 UI 永久禁用。 */
export function runPaneCreateTask(
  task: Promise<unknown>,
  slotIndex: number,
  setCreatingPaneSlots: Dispatch<SetStateAction<Record<number, boolean>>>,
  options?: PaneCreateTaskOptions,
) {
  const minLoadingMs = options?.minLoadingMs ?? PANE_CREATE_MIN_LOADING_MS;
  const timeoutMs = options?.timeoutMs ?? PANE_CREATE_TIMEOUT_MS;
  setCreatingPaneSlots((prev) => ({ ...prev, [slotIndex]: true }));
  const clearCreating = () => {
    setCreatingPaneSlots((prev) => ({ ...prev, [slotIndex]: false }));
  };
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    clearCreating();
    message.warning("创建会话超时，请重试");
  }, timeoutMs);
  void withMinDuration(task, minLoadingMs).finally(() => {
    window.clearTimeout(timeoutId);
    if (!timedOut) {
      clearCreating();
    }
  });
}
