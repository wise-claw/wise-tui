import { memo, Suspense, useMemo, type ReactNode } from "react";
import { Spin } from "antd";
import { lazy } from "react";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import type { WorkspaceRepositoryTreeSelection } from "../../utils/workspaceRepositoryTreeSelect";
import { ActiveRepositoryFilesPanel } from "./ActiveRepositoryFilesPanel";
import { LeftSidebarBottomTabPanes } from "./LeftSidebarBottomTabPanes";
import { LeftSidebarBottomTabSwitcher } from "./LeftSidebarBottomTabSwitcher";
import type { LeftBottomTab } from "./sidebarStorage";
import { leftSidebarRepoPanelBottomSlotPropsEqual } from "./leftSidebarRepoPanelBottomSlotPropsEqual";

const GitPanelLazy = lazy(() => import("../GitPanel").then((module) => ({ default: module.GitPanel })));

export type LeftSidebarRepoPanelBottomSlotProps = {
  showLeftRepoPanel: boolean;
  showLeftSidebarWorkspaceList: boolean;
  repoPanelRenderState: {
    showGitOnLeft: boolean;
    showFilesOnLeft: boolean;
    leftTabMode: boolean;
  };
  workspaceListEffectivelyCollapsed: boolean;
  leftBottomTab: LeftBottomTab;
  onLeftBottomTabChange: (tab: LeftBottomTab) => void;
  bottomTabPanelsReady: boolean;
  effectiveRepoPanelPath: string;
  repoPanelRepositoryName: string;
  gitPanelRepositoryEntries: GitPanelRepositoryEntry[];
  gitPanelContextTitle: string;
  repoPanelTreeSelection: WorkspaceRepositoryTreeSelection | null;
  repoPanelWorkspaceSelectorProps: Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;
  handleOpenExplorerFile: (relativePath: string, options?: GitPanelOpenFileOptions) => void;
  repositoryFileTreeSearch: string;
  onRepositoryFileTreeSearchChange: (value: string) => void;
  filesExplorerSectionCollapsed: boolean;
  onFilesExplorerSectionCollapsedChange: (collapsed: boolean) => void;
};

function toEqualProps(
  props: LeftSidebarRepoPanelBottomSlotProps,
): Parameters<typeof leftSidebarRepoPanelBottomSlotPropsEqual>[0] {
  return {
    effectiveRepoPanelPath: props.effectiveRepoPanelPath,
    repoPanelRepositoryName: props.repoPanelRepositoryName,
    repositoryFileTreeSearch: props.repositoryFileTreeSearch,
    filesExplorerSectionCollapsed: props.filesExplorerSectionCollapsed,
    workspaceListEffectivelyCollapsed: props.workspaceListEffectivelyCollapsed,
    leftBottomTab: props.leftBottomTab,
    bottomTabPanelsReady: props.bottomTabPanelsReady,
    showGitOnLeft: props.repoPanelRenderState.showGitOnLeft,
    showFilesOnLeft: props.repoPanelRenderState.showFilesOnLeft,
    gitPanelRepositoryEntries: props.gitPanelRepositoryEntries,
    gitPanelContextTitle: props.gitPanelContextTitle,
    repoPanelTreeSelection: props.repoPanelTreeSelection,
  };
}

function LeftSidebarRepoPanelBottomSlotInner({
  showLeftRepoPanel,
  showLeftSidebarWorkspaceList,
  repoPanelRenderState,
  workspaceListEffectivelyCollapsed,
  leftBottomTab,
  onLeftBottomTabChange,
  bottomTabPanelsReady,
  effectiveRepoPanelPath,
  repoPanelRepositoryName,
  gitPanelRepositoryEntries,
  gitPanelContextTitle,
  repoPanelTreeSelection,
  repoPanelWorkspaceSelectorProps,
  handleOpenExplorerFile,
  repositoryFileTreeSearch,
  onRepositoryFileTreeSearchChange,
  filesExplorerSectionCollapsed,
  onFilesExplorerSectionCollapsedChange,
}: LeftSidebarRepoPanelBottomSlotProps) {
  const leftTabSwitcherPrefix: ReactNode = repoPanelRenderState.leftTabMode ? (
    <LeftSidebarBottomTabSwitcher activeTab={leftBottomTab} onChange={onLeftBottomTabChange} />
  ) : null;

  const leftSidebarGitBottomPane = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        }
      >
        <GitPanelLazy
          headerPrefix={leftTabSwitcherPrefix ?? undefined}
          repositoryPath={effectiveRepoPanelPath}
          repositoryName={repoPanelRepositoryName}
          repositoryEntries={gitPanelRepositoryEntries}
          multiRepoContextTitle={gitPanelContextTitle}
          onOpenFile={handleOpenExplorerFile}
          lazyMount
          treeSelection={repoPanelTreeSelection}
          {...repoPanelWorkspaceSelectorProps}
        />
      </Suspense>
    ),
    [
      effectiveRepoPanelPath,
      gitPanelContextTitle,
      gitPanelRepositoryEntries,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      repoPanelRepositoryName,
      repoPanelTreeSelection,
      repoPanelWorkspaceSelectorProps,
    ],
  );

  const leftSidebarFilesBottomPane = useMemo(
    () => (
      <ActiveRepositoryFilesPanel
        headerPrefix={leftTabSwitcherPrefix ?? undefined}
        activeRepositoryPath={effectiveRepoPanelPath}
        activeRepositoryName={repoPanelRepositoryName}
        search={repositoryFileTreeSearch}
        onSearchChange={onRepositoryFileTreeSearchChange}
        onOpenFile={handleOpenExplorerFile}
        sectionCollapsed={filesExplorerSectionCollapsed}
        onSectionCollapsedChange={onFilesExplorerSectionCollapsedChange}
        workspaceSelector={repoPanelWorkspaceSelectorProps}
      />
    ),
    [
      effectiveRepoPanelPath,
      filesExplorerSectionCollapsed,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      onFilesExplorerSectionCollapsedChange,
      onRepositoryFileTreeSearchChange,
      repoPanelRepositoryName,
      repoPanelWorkspaceSelectorProps,
      repositoryFileTreeSearch,
    ],
  );

  if (!showLeftRepoPanel) {
    return null;
  }

  return (
    <div className="app-left-sidebar-bottom-tabs">
      <LeftSidebarBottomTabPanes
        showGit={repoPanelRenderState.showGitOnLeft}
        showFiles={repoPanelRenderState.showFilesOnLeft}
        panelsReady={bottomTabPanelsReady}
        gitPane={leftSidebarGitBottomPane}
        filesPane={leftSidebarFilesBottomPane}
      />
    </div>
  );
}

export const LeftSidebarRepoPanelBottomSlot = memo(
  LeftSidebarRepoPanelBottomSlotInner,
  (prev, next) =>
    leftSidebarRepoPanelBottomSlotPropsEqual(toEqualProps(prev), toEqualProps(next)) &&
    prev.showLeftRepoPanel === next.showLeftRepoPanel &&
    prev.showLeftSidebarWorkspaceList === next.showLeftSidebarWorkspaceList &&
    prev.repoPanelRenderState.leftTabMode === next.repoPanelRenderState.leftTabMode,
);
