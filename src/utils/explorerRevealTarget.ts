import { deriveRepoPanelRenderState } from "../components/LeftSidebar/repoPanelPlacement";
import { readLeftBottomTabFromStorage } from "../components/LeftSidebar/sidebarStorage";
import type { MonitorPanelPlacement } from "../services/wiseDefaultConfigStore";

export type ExplorerRevealTarget = "workspace-rail" | "left-sidebar" | "right-rail";

export interface ResolveExplorerRevealTargetInput {
  workspaceFileTreeRailOpen: boolean;
  filesPanelPlacement: MonitorPanelPlacement;
  gitPanelPlacement: MonitorPanelPlacement;
  leftSidebarCollapsed: boolean;
  leftSidebarParked: boolean;
  rightRailAvailable: boolean;
}

export function explorerRevealMatchesTarget(
  pending: { revealTarget?: ExplorerRevealTarget },
  ownRevealTarget: ExplorerRevealTarget,
): boolean {
  if (!pending.revealTarget) {
    return true;
  }
  return pending.revealTarget === ownRevealTarget;
}

/** 当前已展示、可直接定位的文件树实例。 */
export function resolveVisibleExplorerRevealTarget(
  input: ResolveExplorerRevealTargetInput,
): ExplorerRevealTarget | null {
  const leftBottomTab = readLeftBottomTabFromStorage();
  const renderState = deriveRepoPanelRenderState(
    input.gitPanelPlacement,
    input.filesPanelPlacement,
    leftBottomTab,
    { rightRailAvailable: input.rightRailAvailable },
  );

  const leftFilesVisible =
    !input.leftSidebarCollapsed &&
    !input.leftSidebarParked &&
    renderState.showFilesOnLeft;

  const rightFilesVisible = input.rightRailAvailable && renderState.showFilesOnRight;

  if (leftFilesVisible) {
    return "left-sidebar";
  }
  if (rightFilesVisible) {
    return "right-rail";
  }
  if (input.workspaceFileTreeRailOpen) {
    return "workspace-rail";
  }
  return null;
}

/** 搜索/外链打开文件时应定位到的文件树；必要时选择默认展开位置。 */
export function resolveExplorerRevealTargetForOpen(
  input: ResolveExplorerRevealTargetInput,
): ExplorerRevealTarget {
  const visible = resolveVisibleExplorerRevealTarget(input);
  if (visible) {
    return visible;
  }

  const leftBottomTab = readLeftBottomTabFromStorage();
  const renderState = deriveRepoPanelRenderState(
    input.gitPanelPlacement,
    input.filesPanelPlacement,
    leftBottomTab,
    { rightRailAvailable: input.rightRailAvailable },
  );

  if (
    !input.leftSidebarCollapsed &&
    !input.leftSidebarParked &&
    (renderState.showFilesOnLeft || input.filesPanelPlacement === "left")
  ) {
    return "left-sidebar";
  }
  if (input.rightRailAvailable && renderState.showFilesOnRight) {
    return "right-rail";
  }
  return "workspace-rail";
}
