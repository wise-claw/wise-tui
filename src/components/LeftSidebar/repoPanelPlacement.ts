import type { MonitorPanelPlacement } from "../../services/wiseDefaultConfigStore";
import type { LeftBottomTab } from "./sidebarStorage";

export type RepoPanelPlacement = MonitorPanelPlacement;

export interface RepoPanelRenderState {
  showGitOnLeft: boolean;
  showFilesOnLeft: boolean;
  showGitOnRight: boolean;
  showFilesOnRight: boolean;
  leftTabMode: boolean;
  rightTabMode: boolean;
  activeTab: LeftBottomTab;
  /** 配置是否需要右栏（不因 Author/Cockpit 临时隐藏右栏而变化）。 */
  usesRightRail: boolean;
}

export interface DeriveRepoPanelRenderStateOptions {
  /** Chat 模式右栏是否可用；为 false 时仅隐藏右栏内容，不回退配置。 */
  rightRailAvailable?: boolean;
  /** Git 与文件树同栏时是否上下分栏展示（而非 Tab 切换）。 */
  splitMode?: boolean;
}

export function deriveRepoPanelRenderState(
  gitPlacement: RepoPanelPlacement,
  filesPlacement: RepoPanelPlacement,
  activeTab: LeftBottomTab,
  options?: DeriveRepoPanelRenderStateOptions,
): RepoPanelRenderState {
  const rightRailAvailable = options?.rightRailAvailable ?? true;
  const splitMode = options?.splitMode ?? false;
  const leftTabMode = gitPlacement === "left" && filesPlacement === "left";
  const rightTabMode = gitPlacement === "right" && filesPlacement === "right";
  const usesRightRail = gitPlacement === "right" || filesPlacement === "right";

  if (leftTabMode) {
    if (splitMode) {
      return {
        showGitOnLeft: true,
        showFilesOnLeft: true,
        showGitOnRight: false,
        showFilesOnRight: false,
        leftTabMode: false,
        rightTabMode: false,
        activeTab,
        usesRightRail: false,
      };
    }
    return {
      showGitOnLeft: activeTab === "git",
      showFilesOnLeft: activeTab === "files",
      showGitOnRight: false,
      showFilesOnRight: false,
      leftTabMode: true,
      rightTabMode: false,
      activeTab,
      usesRightRail: false,
    };
  }

  if (rightTabMode) {
    if (splitMode) {
      return {
        showGitOnLeft: false,
        showFilesOnLeft: false,
        showGitOnRight: rightRailAvailable,
        showFilesOnRight: rightRailAvailable,
        leftTabMode: false,
        rightTabMode: false,
        activeTab,
        usesRightRail: true,
      };
    }
    return {
      showGitOnLeft: false,
      showFilesOnLeft: false,
      showGitOnRight: rightRailAvailable && activeTab === "git",
      showFilesOnRight: rightRailAvailable && activeTab === "files",
      leftTabMode: false,
      rightTabMode: true,
      activeTab,
      usesRightRail: true,
    };
  }

  return {
    showGitOnLeft: gitPlacement === "left",
    showFilesOnLeft: filesPlacement === "left",
    showGitOnRight: rightRailAvailable && gitPlacement === "right",
    showFilesOnRight: rightRailAvailable && filesPlacement === "right",
    leftTabMode: false,
    rightTabMode: false,
    activeTab,
    usesRightRail,
  };
}
