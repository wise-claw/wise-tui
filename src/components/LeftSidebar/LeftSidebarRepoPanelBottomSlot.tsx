import { memo, Suspense, useMemo, type ReactNode } from "react";
import { Spin } from "antd";
import { lazy } from "react";
import { HoverHint } from "../shared/HoverHint";
import { GitPanelWorkspaceSelector } from "../GitPanel/GitPanelWorkspaceSelector";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import type { WorkspaceRepositoryTreeSelection } from "../../utils/workspaceRepositoryTreeSelect";
import { ActiveRepositoryFilesPanel } from "./ActiveRepositoryFilesPanel";
import { LeftSidebarBottomTabPanes } from "./LeftSidebarBottomTabPanes";
import { LeftSidebarBottomTabSwitcher } from "./LeftSidebarBottomTabSwitcher";
import { ExpandIcon } from "./SidebarIcons";
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
  onExpandWorkspaceList: () => void;
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
  onExpandWorkspaceList,
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
          headerPrefix={
            workspaceListEffectivelyCollapsed ? undefined : leftTabSwitcherPrefix ?? undefined
          }
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
      workspaceListEffectivelyCollapsed,
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
      {repoPanelRenderState.showGitOnLeft && workspaceListEffectivelyCollapsed ? (
        <div className="app-left-sidebar-repo-panel-header">
          {repoPanelRenderState.leftTabMode ? leftTabSwitcherPrefix : null}
          <div className="app-left-sidebar-repo-panel-header__selector">
            <GitPanelWorkspaceSelector
              {...repoPanelWorkspaceSelectorProps}
              activeRepositoryPath={effectiveRepoPanelPath}
            />
          </div>
          {showLeftSidebarWorkspaceList ? (
            <HoverHint title="展开工作区列表">
              <button
                type="button"
                className="app-left-sidebar-repo-panel-header__expand-icon"
                aria-label="展开工作区列表"
                onClick={onExpandWorkspaceList}
              >
                <ExpandIcon expanded={false} />
              </button>
            </HoverHint>
          ) : null}
        </div>
      ) : null}
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
