import type { ExplorerRevealTarget } from "../utils/explorerRevealTarget";

export const WISE_EXPLORER_FOCUS_REQUESTED = "wise:explorer-focus-requested";

export interface ExplorerFocusRequestedDetail {
  target: ExplorerRevealTarget;
}

/** 请求侧栏切换到文件树 Tab 并展开（不打开独立的文件树侧栏）。 */
export function requestExplorerFocus(target: ExplorerRevealTarget): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ExplorerFocusRequestedDetail>(WISE_EXPLORER_FOCUS_REQUESTED, {
      detail: { target },
    }),
  );
}
