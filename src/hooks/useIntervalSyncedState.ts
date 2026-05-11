import { useEffect, useRef, useState } from "react";

/**
 * 将高频变化的引用按固定间隔同步到 React state。
 * 用于「我的团队」等对亚秒级实时性要求不高的只读 UI，避免 `useMonitorOverview` 等与主会话流式更新同频执行巨型 useMemo 导致主线程长时间占用。
 *
 * @param syncKey 变化时立即执行一次 tick（例如 `sessions.length`），新建/关闭标签时监控不必等满一个间隔。
 */
export function useIntervalSyncedState<T>(source: T, intervalMs: number, syncKey?: number | string): T {
  const [synced, setSynced] = useState(source);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    function tick() {
      setSynced((prev) => {
        const next = sourceRef.current;
        return Object.is(prev, next) ? prev : next;
      });
    }
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, syncKey]);

  return synced;
}
