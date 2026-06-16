import { useEffect, useRef, useState } from "react";
import { computeTodoProgress } from "../notifications/todoIngest";
import type { TodoItem } from "../types";

/** 新任务写入或进度推进时自动展开；全部完成后延迟收起。 */
export function useTodoListCollapse(items: readonly TodoItem[], opts?: { autoCollapseDelayMs?: number }) {
  const [collapsed, setCollapsed] = useState(true);
  const prevProgressedRef = useRef(0);
  const prevCountRef = useRef(0);
  const { progressed, allCompleted } = computeTodoProgress(items);
  const autoCollapseDelayMs = opts?.autoCollapseDelayMs ?? 2500;

  useEffect(() => {
    const prevProgressed = prevProgressedRef.current;
    const prevCount = prevCountRef.current;
    prevProgressedRef.current = progressed;
    prevCountRef.current = items.length;

    if (items.length === 0) {
      setCollapsed(true);
      return;
    }
    if (prevCount === 0 && items.length > 0) {
      setCollapsed(false);
      return;
    }
    if (progressed > prevProgressed) {
      setCollapsed(false);
    }
  }, [items.length, progressed]);

  useEffect(() => {
    if (!allCompleted || items.length === 0) return;
    const timer = window.setTimeout(() => setCollapsed(true), autoCollapseDelayMs);
    return () => window.clearTimeout(timer);
  }, [allCompleted, autoCollapseDelayMs, items.length]);

  return { collapsed, setCollapsed, allCompleted };
}
