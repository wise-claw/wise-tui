import { useEffect, type RefObject } from "react";
import { markClaudeScrollInteraction } from "../stores/claudeScrollInteractionGate";
import {
  setFileTreeScrollActive,
  setLeftSidebarScrollActive,
  setWorkspaceScrollActive,
} from "../stores/chromePanelHoverStore";

export type UseScrollEndClassOptions = {
  /** 仅聊天消息区滚动：推迟流式 live 刷新。侧栏/文件树等勿开启。 */
  deferLiveSessionUpdates?: boolean;
  /** 左栏列表滚动：触发侧栏优先级让路（略降聊天区流式开销），不推迟全局 live。 */
  relieveSidePanelPriority?: boolean;
  /** 文件树滚动：在侧栏让路基础上额外加强节流。 */
  relieveFileTreePriority?: boolean;
  /** 工作区列表滚动：在侧栏让路基础上额外加强节流。 */
  relieveWorkspacePriority?: boolean;
};

/** 滚动时在根节点上挂 class，滚动结束 debounce 后移除（用于关闭 transition / 暂停动画）。 */
export function useScrollEndClass(
  scrollRootRef: RefObject<HTMLElement | null>,
  scrollingClassName: string | readonly string[],
  debounceMs = 140,
  options?: UseScrollEndClassOptions,
): void {
  const deferLive = options?.deferLiveSessionUpdates ?? false;
  const relieveSide = options?.relieveSidePanelPriority ?? false;
  const relieveFileTree = options?.relieveFileTreePriority ?? false;
  const relieveWorkspace = options?.relieveWorkspacePriority ?? false;
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
      if (deferLive) markClaudeScrollInteraction();
      if (relieveSide) setLeftSidebarScrollActive(true);
      if (relieveFileTree) setFileTreeScrollActive(true);
      if (relieveWorkspace) setWorkspaceScrollActive(true);
      for (const className of classNames) {
        if (!el.classList.contains(className)) {
          el.classList.add(className);
        }
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        if (relieveSide) setLeftSidebarScrollActive(false);
        if (relieveFileTree) setFileTreeScrollActive(false);
        if (relieveWorkspace) setWorkspaceScrollActive(false);
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
      if (relieveSide) setLeftSidebarScrollActive(false);
      if (relieveFileTree) setFileTreeScrollActive(false);
      if (relieveWorkspace) setWorkspaceScrollActive(false);
      for (const className of classNames) {
        el.classList.remove(className);
      }
    };
  }, [classNamesKey, debounceMs, deferLive, relieveFileTree, relieveSide, relieveWorkspace, scrollRootRef, scrollingClassName]);
}
