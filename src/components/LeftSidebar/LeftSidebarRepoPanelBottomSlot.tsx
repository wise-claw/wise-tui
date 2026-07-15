import { memo, Suspense, useCallback, useMemo, type ReactNode } from "react";
import { Spin } from "antd";
import { lazy } from "react";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import { useRepoPanelSplitHeightPx } from "../../hooks/useRepoPanelSplitHeightPx";
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
  handleOpenExplorerFile: (relativePath: string, options?: GitPanelOpenFileOptions) => void;
  repositoryFileTreeSearch: string;
  onRepositoryFileTreeSearchChange: (value: string) => void;
};

function toEqualProps(
  props: LeftSidebarRepoPanelBottomSlotProps,
): Parameters<typeof leftSidebarRepoPanelBottomSlotPropsEqual>[0] {
  return {
    effectiveRepoPanelPath: props.effectiveRepoPanelPath,
    repoPanelRepositoryName: props.repoPanelRepositoryName,
    repositoryFileTreeSearch: props.repositoryFileTreeSearch,
    workspaceListEffectivelyCollapsed: props.workspaceListEffectivelyCollapsed,
    leftBottomTab: props.leftBottomTab,
    bottomTabPanelsReady: props.bottomTabPanelsReady,
    showGitOnLeft: props.repoPanelRenderState.showGitOnLeft,
    showFilesOnLeft: props.repoPanelRenderState.showFilesOnLeft,
    gitPanelRepositoryEntries: props.gitPanelRepositoryEntries,
  };
}

function LeftSidebarRepoPanelBottomSlotInner({
  showLeftRepoPanel,
  repoPanelRenderState,
  leftBottomTab,
  onLeftBottomTabChange,
  bottomTabPanelsReady,
  effectiveRepoPanelPath,
  repoPanelRepositoryName,
  gitPanelRepositoryEntries,
  handleOpenExplorerFile,
  repositoryFileTreeSearch,
  onRepositoryFileTreeSearchChange,
}: LeftSidebarRepoPanelBottomSlotProps) {
  // 同栏上下分栏时 Git 面板的高度（持久化到 default config store）。
  const { heightPx, setHeightPx, save: saveSplitHeight, loading: splitHeightLoading } =
    useRepoPanelSplitHeightPx();

  const onSplitHeightChange = useCallback(
    (next: number) => {
      setHeightPx(next);
    },
    [setHeightPx],
  );

  const onSplitHeightCommit = useCallback(
    (committed: number) => {
      void saveSplitHeight(committed);
    },
    [saveSplitHeight],
  );

  // split 模式下文件树自动撑满，Git 面板走 inline height。
  // 拖动期间频繁 setHeightPx → heightPx 高频变化 → 这里只构造新对象给 memo 子组件。
  // 但 LeftSidebarBottomTabPanes 对 style 不做深度 equal — 因此只在 isSplit 时构造对象，频繁更新只会让 memo 失效 → 高频本身不可避免。
  const gitPaneStyle = useMemo(
    () =>
      repoPanelRenderState.showGitOnLeft &&
      repoPanelRenderState.showFilesOnLeft &&
      bottomTabPanelsReady
        ? {
            height: heightPx,
            minHeight: 0,
            flex: "0 0 auto",
          }
        : undefined,
    [
      bottomTabPanelsReady,
      heightPx,
      repoPanelRenderState.showFilesOnLeft,
      repoPanelRenderState.showGitOnLeft,
    ],
  );

  const filesPaneStyle = useMemo(
    () =>
      repoPanelRenderState.showGitOnLeft &&
      repoPanelRenderState.showFilesOnLeft &&
      bottomTabPanelsReady
        ? { minHeight: 0, flex: "1 1 0" }
        : undefined,
    [
      bottomTabPanelsReady,
      repoPanelRenderState.showFilesOnLeft,
      repoPanelRenderState.showGitOnLeft,
    ],
  );

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
          onOpenFile={handleOpenExplorerFile}
          lazyMount
        />
      </Suspense>
    ),
    [
      effectiveRepoPanelPath,
      gitPanelRepositoryEntries,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      repoPanelRepositoryName,
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
      />
    ),
    [
      effectiveRepoPanelPath,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      onRepositoryFileTreeSearchChange,
      repoPanelRepositoryName,
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
        panelsReady={bottomTabPanelsReady && !splitHeightLoading}
        gitPane={leftSidebarGitBottomPane}
        filesPane={leftSidebarFilesBottomPane}
        splitGitHeightPx={heightPx}
        gitPaneStyle={gitPaneStyle}
        filesPaneStyle={filesPaneStyle}
        onSplitHeightChange={onSplitHeightChange}
        onSplitHeightCommit={onSplitHeightCommit}
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
