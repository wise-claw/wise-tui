import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES,
  DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES,
} from "../constants/directBatchInvocationLog";

/**
 * 与 `directBatchInvocationLog`、直连批量环形捕获、落盘快照上限一致；
 * 本 hook 仅用于 OMC 直连批量详情抽屉，避免实时订阅截短后重开/合并时丢前半段 stream-json。
 */
const MAX_STDOUT_LINES = DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES;
const MAX_STDERR_LINES = DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES;
const MAX_LINE_CHARS = 8000;

export interface UseClaudeInvocationLiveOutputParams {
  invocationKey: string | null | undefined;
  /** 为 false 时不订阅（例如 Drawer 关闭） */
  enabled: boolean;
  /** 来自侧栏快照：子进程已结束时不再视为流式 */
  parentInvocationFinished: boolean;
}

export interface UseClaudeInvocationLiveOutputResult {
  stdoutLines: string[];
  stderrLines: string[];
  /** 子进程已结束（Tauri complete 事件或父级 phase === complete） */
  invocationComplete: boolean;
  /** 已收到 `claude-complete:invocation:*`；不含仅凭侧栏 phase 推断的完成 */
  tauriComplete: boolean;
}

/**
 * 订阅 `claude-output/error/complete:invocation:{key}`，供 OMC 直连批量详情 Drawer 等场景展示子进程实时输出。
 * 与 `executeClaudeCodeAndWait` 内已有监听并行，互不干扰。
 */
export function useClaudeInvocationLiveOutput(
  params: UseClaudeInvocationLiveOutputParams,
): UseClaudeInvocationLiveOutputResult {
  const { invocationKey, enabled, parentInvocationFinished } = params;
  const key = typeof invocationKey === "string" ? invocationKey.trim() : "";

  const [stdoutLines, setStdoutLines] = useState<string[]>([]);
  const [stderrLines, setStderrLines] = useState<string[]>([]);
  const [localComplete, setLocalComplete] = useState(false);

  const stdoutRef = useRef<string[]>([]);
  const stderrRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !key) {
      stdoutRef.current = [];
      stderrRef.current = [];
      setStdoutLines([]);
      setStderrLines([]);
      return;
    }

    setLocalComplete(false);
    stdoutRef.current = [];
    stderrRef.current = [];
    setStdoutLines([]);
    setStderrLines([]);

    let cancelled = false;
    const unsubs: UnlistenFn[] = [];

    function flushFromRefs() {
      setStdoutLines([...stdoutRef.current]);
      setStderrLines([...stderrRef.current]);
    }

    function scheduleFlush() {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!cancelled) {
          flushFromRefs();
        }
      });
    }

    void (async () => {
      try {
        const [uo, ue, uc] = await Promise.all([
          listen<string>(`claude-output:invocation:${key}`, (ev) => {
            const raw = String(ev.payload ?? "");
            const line =
              raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…[truncated]` : raw;
            const arr = stdoutRef.current;
            arr.push(line);
            if (arr.length > MAX_STDOUT_LINES * 2) {
              arr.splice(0, arr.length - MAX_STDOUT_LINES);
            }
            scheduleFlush();
          }),
          listen<string>(`claude-error:invocation:${key}`, (ev) => {
            const raw = String(ev.payload ?? "");
            const line =
              raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…[truncated]` : raw;
            const arr = stderrRef.current;
            arr.push(line);
            if (arr.length > MAX_STDERR_LINES * 2) {
              arr.splice(0, arr.length - MAX_STDERR_LINES);
            }
            scheduleFlush();
          }),
          listen<{ success?: boolean }>(`claude-complete:invocation:${key}`, () => {
            setLocalComplete(true);
            scheduleFlush();
          }),
        ]);
        if (cancelled) {
          safeUnlisten(uo);
          safeUnlisten(ue);
          safeUnlisten(uc);
          return;
        }
        unsubs.push(uo, ue, uc);
      } catch {
        /* 浏览器 / 无 Tauri */
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      for (const u of unsubs) {
        safeUnlisten(u);
      }
      stdoutRef.current = [];
      stderrRef.current = [];
    };
  }, [enabled, key]);

  const invocationComplete = parentInvocationFinished || localComplete;

  return { stdoutLines, stderrLines, invocationComplete, tauriComplete: localComplete };
}
