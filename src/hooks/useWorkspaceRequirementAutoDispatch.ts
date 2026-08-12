import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { dispatchRequirementToExecutionEnvironment } from "../constants/pendingTaskQueueEvents";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { buildRequirementDispatchPayload } from "../services/workspaceRequirementDispatch";
import {
  getWorkspaceRequirementAutoDispatch,
  getWorkspaceRequirementAutoDispatchConcurrency,
  loadWorkspaceRequirements,
  setWorkspaceRequirementAutoDispatch,
  setWorkspaceRequirementAutoDispatchConcurrency,
  updateWorkspaceRequirement,
  WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED,
  WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED,
  WISE_WORKSPACE_REQUIREMENTS_CHANGED,
  WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_DEFAULT,
} from "../services/workspaceRequirementsStore";
import {
  autoDispatchAvailableSlots,
  planAutoDispatchSweep,
} from "../utils/workspaceRequirementAutoDispatch";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";

const AUTO_DISPATCH_TICK_MS = 30_000;
const AUTO_DISPATCH_TICK_MS_HIDDEN = 120_000;
/** 需求列表变化后去抖触发派发，避免新增/编辑保存瞬间重复扫描。 */
const AUTO_DISPATCH_CHANGE_DEBOUNCE_MS = 1_500;
/** 一轮派发后的冷却：避免「派发→标记已派发→变化事件→再派发」级联，把需求一次性全丢出去。 */
const AUTO_DISPATCH_SWEEP_COOLDOWN_MS = 10_000;

/** 面板用：读取/切换需求自动派发开关与并发数（两处面板通过广播保持同步）。 */
export function useWorkspaceRequirementAutoDispatchSetting(): {
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  concurrency: number;
  setConcurrency: (next: number) => Promise<void>;
} {
  const [enabled, setEnabledState] = useState(false);
  const [concurrency, setConcurrencyState] = useState(
    WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_DEFAULT,
  );

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceRequirementAutoDispatch().then((value) => {
      if (!cancelled) setEnabledState(value);
    });
    void getWorkspaceRequirementAutoDispatchConcurrency().then((value) => {
      if (!cancelled) setConcurrencyState(value);
    });
    const onChange = (event: Event) => {
      setEnabledState(Boolean((event as CustomEvent<boolean>).detail));
    };
    const onConcurrencyChange = (event: Event) => {
      setConcurrencyState(Number((event as CustomEvent<number>).detail));
    };
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED, onChange);
    window.addEventListener(
      WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED,
      onConcurrencyChange,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED, onChange);
      window.removeEventListener(
        WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED,
        onConcurrencyChange,
      );
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    await setWorkspaceRequirementAutoDispatch(next);
  }, []);

  const setConcurrency = useCallback(async (next: number) => {
    await setWorkspaceRequirementAutoDispatchConcurrency(next);
  }, []);

  return { enabled, setEnabled, concurrency, setConcurrency };
}

/**
 * App 级自动派发引擎：开关开启后，轮询 + 需求变化事件触发，
 * 把「新增/编辑过」的 open 需求派发到当前执行环境（与手动派发同一路径）。
 * 每轮按「并发数 − 当前运行会话数」动态决定派发条数。
 */
export function useWorkspaceRequirementAutoDispatchEngine({
  countRunningSessionsRef,
}: {
  countRunningSessionsRef: MutableRefObject<() => number>;
}): void {
  const enabledRef = useRef(false);
  const concurrencyRef = useRef(WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_DEFAULT);
  const sweepingRef = useRef(false);
  const changeTimerRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);
  const cooldownRetryTimerRef = useRef<number | null>(null);

  const sweepOnce = useCallback(async () => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    if (!enabledRef.current) return;
    if (sweepingRef.current) return;
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      // 冷却中：安排一次冷却结束后的重试，避免这一轮被直接吞掉后要等下一个 30s tick。
      if (cooldownRetryTimerRef.current == null) {
        cooldownRetryTimerRef.current = window.setTimeout(() => {
          cooldownRetryTimerRef.current = null;
          void sweepOnce();
        }, cooldownUntilRef.current - now);
      }
      return;
    }
    sweepingRef.current = true;
    let dispatched = 0;
    try {
      const payload = await loadWorkspaceRequirements();
      // 单轮派发上限 = min(并发槽位, AUTO_DISPATCH_MAX_PER_SWEEP)，并发再大也不会一次全丢。
      const targets = planAutoDispatchSweep(
        concurrencyRef.current,
        countRunningSessionsRef.current(),
        payload.items,
      );
      for (const item of targets) {
        // 派发前再校验一次槽位：异步间隙里会话可能已启动（含其他窗口/手动派发）。
        if (
          autoDispatchAvailableSlots(
            concurrencyRef.current,
            countRunningSessionsRef.current(),
          ) <= 0
        ) {
          break;
        }
        let accepted = false;
        let imagePaths: string[] = [];
        try {
          const built = await buildRequirementDispatchPayload(item);
          imagePaths = built.imagePaths;
          accepted = dispatchRequirementToExecutionEnvironment({
            promptText: built.promptText,
            userBubblePrompt: built.executeBubbleOptions?.userBubblePrompt ?? built.promptText,
            source: "workspace-requirement-auto",
            requirementId: item.id,
          });
        } catch (err) {
          console.error("[WorkspaceRequirementAutoDispatch] build/dispatch failed", err);
          continue;
        }
        if (!accepted) continue;
        dispatched += 1;
        const dispatchedAt = Date.now();
        try {
          await updateWorkspaceRequirement(item.id, (row) => ({
            ...row,
            bodyMarkdown: row.bodyMarkdown || item.bodyMarkdown,
            imagePaths: imagePaths.length > 0 ? imagePaths : row.imagePaths,
            lastDispatchedAt: dispatchedAt,
            updatedAt: dispatchedAt,
          }));
        } catch (err) {
          // 需求可能在派发途中被删除/整表覆盖，忽略即可（下一轮会重试）。
          console.error("[WorkspaceRequirementAutoDispatch] mark dispatched failed", err);
        }
      }
      if (dispatched > 0) {
        cooldownUntilRef.current = Date.now() + AUTO_DISPATCH_SWEEP_COOLDOWN_MS;
      }
    } catch (err) {
      console.error("[WorkspaceRequirementAutoDispatch] sweep failed", err);
    } finally {
      sweepingRef.current = false;
    }
  }, [countRunningSessionsRef]);

  const scheduleDebouncedSweep = useCallback(() => {
    if (changeTimerRef.current != null) {
      window.clearTimeout(changeTimerRef.current);
    }
    changeTimerRef.current = window.setTimeout(() => {
      changeTimerRef.current = null;
      void sweepOnce();
    }, AUTO_DISPATCH_CHANGE_DEBOUNCE_MS);
  }, [sweepOnce]);

  useEffect(() => {
    let cancelled = false;

    void getWorkspaceRequirementAutoDispatch().then((value) => {
      if (cancelled) return;
      enabledRef.current = value;
      if (value) void sweepOnce();
    });
    void getWorkspaceRequirementAutoDispatchConcurrency().then((value) => {
      if (cancelled) return;
      concurrencyRef.current = value;
    });

    const onToggle = (event: Event) => {
      const next = Boolean((event as CustomEvent<boolean>).detail);
      enabledRef.current = next;
      if (next) scheduleDebouncedSweep();
    };
    const onConcurrencyChange = (event: Event) => {
      concurrencyRef.current = Number((event as CustomEvent<number>).detail);
      scheduleDebouncedSweep();
    };
    const onRequirementsChanged = () => scheduleDebouncedSweep();
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED, onToggle);
    window.addEventListener(
      WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED,
      onConcurrencyChange,
    );
    window.addEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void sweepOnce();
    };
    const intervalMs = readVisiblePollIntervalMs(
      AUTO_DISPATCH_TICK_MS,
      AUTO_DISPATCH_TICK_MS_HIDDEN,
    );
    const id = window.setInterval(tick, intervalMs);
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void sweepOnce();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CHANGED, onToggle);
      window.removeEventListener(
        WISE_WORKSPACE_REQUIREMENTS_AUTO_DISPATCH_CONCURRENCY_CHANGED,
        onConcurrencyChange,
      );
      window.removeEventListener(WISE_WORKSPACE_REQUIREMENTS_CHANGED, onRequirementsChanged);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (changeTimerRef.current != null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (cooldownRetryTimerRef.current != null) {
        window.clearTimeout(cooldownRetryTimerRef.current);
        cooldownRetryTimerRef.current = null;
      }
    };
  }, [scheduleDebouncedSweep, sweepOnce]);
}
