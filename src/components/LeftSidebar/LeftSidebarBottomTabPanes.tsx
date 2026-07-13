import { memo, type CSSProperties, type ReactNode } from "react";
import { RepoPanelSplitResizeHandle } from "../RepoPanelSplitResizeHandle";

export type LeftSidebarBottomTabPanesProps = {
  showGit: boolean;
  showFiles: boolean;
  gitPane: ReactNode;
  filesPane: ReactNode;
  panelsReady: boolean;
  /** split 模式下 Git 面板「按下瞬间」高度，用于 resize handle 计算 delta。 */
  splitGitHeightPx?: number;
  /** split 模式下传给 Git 面板的内联样式；非 split 时透传 `undefined`。 */
  gitPaneStyle?: CSSProperties;
  /** split 模式下传给文件树的内联样式；非 split 时透传 `undefined`。 */
  filesPaneStyle?: CSSProperties;
  /** split 模式下拖把高频回调：父组件用它更新本地 height state。 */
  onSplitHeightChange?: (nextHeightPx: number) => void;
  /** split 模式下拖把释放时的最终值回调：父组件用它落盘持久化。 */
  onSplitHeightCommit?: (committedHeightPx: number) => void;
};

/**
 * Git / 文件同栏保活：切换 Tab 时仅隐藏，避免卸载 GitPanel / 文件树导致反复重建。
 * 同栏上下分栏时文件树在上、Git 在下，两者之间插入可拖动的 resize handle；
 * 高度由父组件通过 `gitPaneStyle` 控制（持久化到 default config store）。
 */
export const LeftSidebarBottomTabPanes = memo(function LeftSidebarBottomTabPanes({
  showGit,
  showFiles,
  gitPane,
  filesPane,
  panelsReady,
  splitGitHeightPx,
  gitPaneStyle,
  filesPaneStyle,
  onSplitHeightChange,
  onSplitHeightCommit,
}: LeftSidebarBottomTabPanesProps) {
  const isSplit = showGit && showFiles && panelsReady;

  if (!panelsReady) {
    return (
      <div className="app-left-sidebar-bottom-tab-content app-left-sidebar-bottom-tab-content--loading">
        {showGit ? gitPane : filesPane}
      </div>
    );
  }

  return (
    <div
      className={
        "app-left-sidebar-bottom-tab-content" +
        (isSplit ? " app-left-sidebar-bottom-tab-content--split" : "")
      }
    >
      {/* 上下分栏时文件树在上 */}
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (!showFiles ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={!showFiles ? true : undefined}
        aria-hidden={!showFiles}
        style={isSplit ? filesPaneStyle : undefined}
      >
        {filesPane}
      </div>
      {isSplit && onSplitHeightChange && (
        <RepoPanelSplitResizeHandle
          startHeightPx={splitGitHeightPx ?? 230}
          onHeightChange={onSplitHeightChange}
          onHeightCommit={onSplitHeightCommit}
        />
      )}
      {/* 上下分栏时 Git 在下，高度由父组件传入 */}
      <div
        className={
          "app-left-sidebar-bottom-tab-pane" +
          (!showGit ? " app-left-sidebar-bottom-tab-pane--hidden" : "")
        }
        hidden={!showGit ? true : undefined}
        aria-hidden={!showGit}
        style={isSplit ? gitPaneStyle : undefined}
      >
        {gitPane}
      </div>
    </div>
  );
});
