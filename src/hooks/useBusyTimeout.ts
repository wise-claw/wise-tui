import { useEffect, useRef } from "react";
import { BUSY_FLAG_MAX_MS } from "../utils/ipcTimeouts";

/**
 * 当 busy 长时间为 true 时强制回调复位，避免 confirmLoading / Spin 永久锁死交互。
 */
export function useBusyTimeout(
  busy: boolean,
  onTimeout: () => void,
  timeoutMs: number = BUSY_FLAG_MAX_MS,
): void {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [busy, timeoutMs]);
}
