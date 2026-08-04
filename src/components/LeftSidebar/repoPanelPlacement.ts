import type { RepoPanelVisibility } from "../../services/wiseDefaultConfigStore";
import type { LeftBottomTab } from "./sidebarStorage";

export type RepoPanelPlacement = RepoPanelVisibility;

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
  /** Chat 模式右栏是否可用；保留参数以兼容旧调用，Git/文件树已不再放到右栏。 */
  rightRailAvailable?: boolean;
  /** Git 与文件树同栏时是否上下分栏展示（而非 Tab 切换）。 */
  splitMode?: boolean;
}

export function deriveRepoPanelRenderState(
  gitVisibility: RepoPanelPlacement,
  filesVisibility: RepoPanelPlacement,
  activeTab: LeftBottomTab,
  options?: DeriveRepoPanelRenderStateOptions,
): RepoPanelRenderState {
  const splitMode = options?.splitMode ?? false;
  const gitVisible = gitVisibility === "visible";
  const filesVisible = filesVisibility === "visible";

  if (gitVisible && filesVisible) {
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

  return {
    showGitOnLeft: gitVisible,
    showFilesOnLeft: filesVisible,
    showGitOnRight: false,
    showFilesOnRight: false,
    leftTabMode: false,
    rightTabMode: false,
    activeTab,
    usesRightRail: false,
  };
}
