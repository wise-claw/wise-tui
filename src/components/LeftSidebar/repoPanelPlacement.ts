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
  usesRightRail: boolean;
}

export function resolveRepoPanelPlacements(
  gitPlacement: RepoPanelPlacement,
  filesPlacement: RepoPanelPlacement,
  rightRailAvailable: boolean,
): { git: RepoPanelPlacement; files: RepoPanelPlacement; coerced: boolean } {
  let git = gitPlacement;
  let files = filesPlacement;
  let coerced = false;
  if (!rightRailAvailable) {
    if (git === "right") {
      git = "left";
      coerced = true;
    }
    if (files === "right") {
      files = "left";
      coerced = true;
    }
  }
  return { git, files, coerced };
}

export function deriveRepoPanelRenderState(
  gitPlacement: RepoPanelPlacement,
  filesPlacement: RepoPanelPlacement,
  activeTab: LeftBottomTab,
): RepoPanelRenderState {
  const leftTabMode = gitPlacement === "left" && filesPlacement === "left";
  const rightTabMode = gitPlacement === "right" && filesPlacement === "right";

  if (leftTabMode) {
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
    return {
      showGitOnLeft: false,
      showFilesOnLeft: false,
      showGitOnRight: activeTab === "git",
      showFilesOnRight: activeTab === "files",
      leftTabMode: false,
      rightTabMode: true,
      activeTab,
      usesRightRail: true,
    };
  }

  return {
    showGitOnLeft: gitPlacement === "left",
    showFilesOnLeft: filesPlacement === "left",
    showGitOnRight: gitPlacement === "right",
    showFilesOnRight: filesPlacement === "right",
    leftTabMode: false,
    rightTabMode: false,
    activeTab,
    usesRightRail: true,
  };
}
