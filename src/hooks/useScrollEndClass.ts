import { useEffect, type RefObject } from "react";

/** 滚动时在根节点上挂 class，滚动结束 debounce 后移除（用于关闭 transition / 暂停动画）。 */
export function useScrollEndClass(
  scrollRootRef: RefObject<HTMLElement | null>,
  scrollingClassName: string | readonly string[],
  debounceMs = 140,
): void {
  const classNamesKey =
    typeof scrollingClassName === "string" ? scrollingClassName : scrollingClassName.join("\n");
  useEffect(() => {
    const classNames =
      typeof scrollingClassName === "string" ? [scrollingClassName] : [...scrollingClassName];
    const el = scrollRootRef.current;
    if (!el) return;
    let scrollEndTimer: ReturnType<typeof setTimeout> | undefined;
    let rafId = 0;
    const markScrolling = () => {
      for (const className of classNames) {
        if (!el.classList.contains(className)) {
          el.classList.add(className);
        }
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        for (const className of classNames) {
          el.classList.remove(className);
        }
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
      for (const className of classNames) {
        el.classList.remove(className);
      }
    };
  }, [classNamesKey, debounceMs, scrollRootRef, scrollingClassName]);
}
