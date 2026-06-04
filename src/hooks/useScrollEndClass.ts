import { useEffect, type RefObject } from "react";

/** 滚动时在根节点上挂 class，滚动结束 debounce 后移除（用于关闭 transition / 暂停动画）。 */
export function useScrollEndClass(
  scrollRootRef: RefObject<HTMLElement | null>,
  scrollingClassName: string,
  debounceMs = 140,
): void {
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;
    let scrollEndTimer: ReturnType<typeof setTimeout> | undefined;
    let rafId = 0;
    const markScrolling = () => {
      if (!el.classList.contains(scrollingClassName)) {
        el.classList.add(scrollingClassName);
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        el.classList.remove(scrollingClassName);
      }, debounceMs);
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        markScrolling();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      el.classList.remove(scrollingClassName);
    };
  }, [debounceMs, scrollRootRef, scrollingClassName]);
}
