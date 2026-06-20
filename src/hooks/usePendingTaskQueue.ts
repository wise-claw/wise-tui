import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "antd";
import type { PendingExecutionTask } from "../types";
import {
  readPendingTaskQueue,
  writePendingTaskQueue,
} from "../services/pendingTaskQueueStore";

const WRITE_FAIL_TOAST_COOLDOWN_MS = 14_000;

export function usePendingTaskQueue(sessionId: string, repositoryPath: string) {
  const [tasks, setTasks] = useState<PendingExecutionTask[]>([]);
  const inFlightReloadRef = useRef(false);
  const reloadSeqRef = useRef(0);
  const mountedRef = useRef(true);
  /** 本地入队/删改自增；reload 若在读取期间发生过变更则丢弃结果，避免旧磁盘快照盖掉新状态 */
  const mutationEpochRef = useRef(0);
  const lastWriteFailToastAtRef = useRef(0);
  /** 串行化磁盘写入，避免多次 flush 乱序完成把旧队列快照写回存储 */
  const persistChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    persistChainRef.current = Promise.resolve();
  }, [sessionId, repositoryPath]);

  const bumpMutationEpoch = useCallback(() => {
    mutationEpochRef.current += 1;
  }, []);

  const notifyWriteFailed = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteFailToastAtRef.current < WRITE_FAIL_TOAST_COOLDOWN_MS) {
      return;
    }
    lastWriteFailToastAtRef.current = now;
    message.warning("待执行队列未能写入本地存储，派发记录可能无法在重启后保留；请稍后重试或检查应用数据目录权限。");
  }, []);

  const enqueueWrite = useCallback(
    (snapshot: PendingExecutionTask[]) => {
      persistChainRef.current = persistChainRef.current
        .then(async () => {
          if (!mountedRef.current) return;
          const ok = await writePendingTaskQueue(sessionId, repositoryPath, snapshot);
          if (!ok && mountedRef.current) {
            notifyWriteFailed();
          }
        })
        .catch(() => {
          /* 避免链断裂 */
        });
    },
    [sessionId, repositoryPath, notifyWriteFailed],
  );

  const reload = useCallback(async () => {
    if (inFlightReloadRef.current) {
      return;
    }
    inFlightReloadRef.current = true;
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    const epochBeforeRead = mutationEpochRef.current;
    try {
      const rows = await readPendingTaskQueue(sessionId, repositoryPath);
      if (!mountedRef.current || seq !== reloadSeqRef.current) {
        return;
      }
      if (epochBeforeRead !== mutationEpochRef.current) {
        return;
      }
      setTasks(rows);
    } finally {
      if (seq === reloadSeqRef.current) {
        inFlightReloadRef.current = false;
      }
    }
  }, [sessionId, repositoryPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void reload();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reload]);

  const persist = useCallback(
    (next: PendingExecutionTask[]) => {
      bumpMutationEpoch();
      setTasks(next);
      enqueueWrite(next);
    },
    [bumpMutationEpoch, enqueueWrite],
  );

  const addTask = useCallback(
    (task: Omit<PendingExecutionTask, "id" | "createdAt">): PendingExecutionTask => {
      bumpMutationEpoch();
      const id = `ptq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const row: PendingExecutionTask = { ...task, id, createdAt: Date.now() };
      setTasks((prev) => {
        const next = [...prev, row];
        enqueueWrite(next);
        return next;
      });
      return row;
    },
    [bumpMutationEpoch, enqueueWrite],
  );

  const removeTask = useCallback(
    (id: string) => {
      bumpMutationEpoch();
      setTasks((prev) => {
        const next = prev.filter((t) => t.id !== id);
        enqueueWrite(next);
        return next;
      });
    },
    [bumpMutationEpoch, enqueueWrite],
  );

  const pinTask = useCallback(
    (id: string) => {
      bumpMutationEpoch();
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx <= 0) return prev;
        const item = prev[idx]!;
        const next = [item, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
        enqueueWrite(next);
        return next;
      });
    },
    [bumpMutationEpoch, enqueueWrite],
  );

  const updateTask = useCallback(
    (
      id: string,
      fields: Partial<
        Pick<
          PendingExecutionTask,
          | "promptText"
          | "executorLabel"
          | "targetType"
          | "targetEmployeeName"
          | "targetWorkflowId"
          | "targetWorkflowName"
        >
      >,
    ) => {
      bumpMutationEpoch();
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, ...fields } : t));
        enqueueWrite(next);
        return next;
      });
    },
    [bumpMutationEpoch, enqueueWrite],
  );

  const clearAll = useCallback(() => {
    persist([]);
  }, [persist]);

  return { tasks, addTask, removeTask, pinTask, updateTask, clearAll, reload };
}
