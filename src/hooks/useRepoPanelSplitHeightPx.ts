import { useCallback, useEffect, useRef, useState } from "react";
import {
  REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX,
  clampRepoPanelSplitHeightPx,
} from "../constants/repoPanelLayout";
import {
  loadRepoPanelSplitHeightFromStore,
  saveRepoPanelSplitHeightToStore,
  WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface UseRepoPanelSplitHeightPxResult {
  /** 当前 Git 面板高度（已 clamp 到合法范围）。 */
  heightPx: number;
  /** 拖动期间高频更新本地 state；不会写盘。 */
  setHeightPx: (next: number) => void;
  /** 拖动结束时调用，落盘到 default config store 并广播变更事件。 */
  save: (next: number) => Promise<void>;
  /** 初次 hydrate store 完成前为 true；期间不渲染拖把，避免闪现默认值。 */
  loading: boolean;
}

/**
 * 订阅左栏 split 模式下 Git 面板高度的持久化状态。
 * - mount 时从 store 读初值（clamp 后）
 * - 监听 WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED 全局事件做同步
 * - `setHeightPx` 仅更新本地（拖动期间 60fps 调用，无 IO）
 * - `save` 写盘 + 派发变更事件
 */
export function useRepoPanelSplitHeightPx(): UseRepoPanelSplitHeightPxResult {
  const [heightPx, setHeightPxState] = useState(REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX);
  const [loading, setLoading] = useState(true);
  const heightRef = useRef(heightPx);
  heightRef.current = heightPx;

  const apply = useCallback((next: number) => {
    setHeightPxState(clampRepoPanelSplitHeightPx(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRepoPanelSplitHeightFromStore().then((loaded) => {
      if (cancelled) return;
      apply(loaded);
      setLoading(false);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ repoPanelSplitHeightPx?: number }>).detail
        ?.repoPanelSplitHeightPx;
      if (typeof next === "number" && Number.isFinite(next)) {
        apply(next);
      }
    };
    window.addEventListener(WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED, onChanged);
    };
  }, [apply]);

  const setHeightPx = useCallback((next: number) => {
    apply(next);
  }, [apply]);

  const save = useCallback(async (next: number) => {
    const clamped = clampRepoPanelSplitHeightPx(next);
    if (clamped === heightRef.current) return;
    await saveRepoPanelSplitHeightToStore(clamped);
  }, []);

  return { heightPx, setHeightPx, save, loading };
}