import { useEffect, useMemo, useRef } from "react";
import {
  computeComposerExecutionBusy,
  type ComposerBusyResult,
} from "./composerExecutionBusy";

/** Hook 入参：所有信号由调用方注入（含 backgroundContextCompactInFlight），
 *  避免与 `useBackgroundContextCompactInFlight` 重复订阅 store。 */
export interface ComposerExecutionBusyHookInput {
  sessionStatus: string | undefined;
  backgroundContextCompactInFlight: boolean;
  pendingExecutionTaskCount: number;
  streamingResident?: boolean;
}

/** 后台压缩 turn finally 翻 false 与 session.status 翻 idle 之间的瞬时窗口，
 *  保留「结束」按钮显示。200ms 覆盖 rust 端事件回传 + transcript 重载耗时。 */
export const COMPOSER_EXECUTION_BUSY_STICKY_RELEASE_MS = 200;

/**
 * 把多个来源的信号收敛为一个 sticky 的「正在执行」判定。
 *
 * 进入 busy（任意源命中）立即生效；离开 busy 需等待 STICKY_RELEASE_MS 防止状态源之间
 * 的瞬时错位让按钮闪烁。
 *
 * 返回值不保证引用稳定（每次 raw 变化都会换对象），下游不应基于
 * `composerBusy` 引用做 useMemo 依赖，应基于其内部字段（isBusy / source）。
 */
export function useComposerExecutionBusy(
  input: ComposerExecutionBusyHookInput,
): ComposerBusyResult {
  const raw = useMemo(
    () =>
      computeComposerExecutionBusy({
        sessionStatus: input.sessionStatus,
        backgroundContextCompactInFlight: input.backgroundContextCompactInFlight,
        pendingExecutionTaskCount: input.pendingExecutionTaskCount,
        streamingResident: input.streamingResident,
      }),
    [
      input.sessionStatus,
      input.backgroundContextCompactInFlight,
      input.pendingExecutionTaskCount,
      input.streamingResident,
    ],
  );

  /** sticky busy：进入立即 true；离开需等待 STICKY_RELEASE_MS 才允许 false。
   *  使用 ref + effect 而不是 useState，避免防抖期间 React 树触发额外渲染。 */
  const stickyBusyRef = useRef(raw.isBusy);
  const stickySourceRef = useRef<ComposerBusyResult["source"]>(raw.source);

  useEffect(() => {
    if (raw.isBusy) {
      return undefined;
    }
    const timer = setTimeout(() => {
      stickyBusyRef.current = false;
      stickySourceRef.current = raw.source;
    }, COMPOSER_EXECUTION_BUSY_STICKY_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [raw.isBusy, raw.source]);

  // 同步阶段：raw=busy 立即同步 stickySourceRef；raw=idle 不修改（避免在 sticky 窗口内被覆盖）
  if (raw.isBusy) {
    stickyBusyRef.current = true;
    stickySourceRef.current = raw.source;
    return { isBusy: true, source: raw.source };
  }

  if (stickyBusyRef.current) {
    return { isBusy: true, source: stickySourceRef.current };
  }
  return raw;
}