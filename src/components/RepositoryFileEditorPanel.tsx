import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { AimOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Dropdown, Spin, type MenuProps } from "antd";
import { RepositoryFileEditorTabSurface } from "./RepositoryFileEditorTabSurface";
import { HoverHint } from "./shared/HoverHint";
import type { FileEditorTab } from "../hooks/useRepositoryFileEditor";

/**
 * keep-alive 保留的 Monaco 实例上限。超出时最久未活跃的 tab 被逐出（卸载编辑器），
 * 平衡切换流畅度与内存/TS worker 项目图规模。
 */
const FILE_EDITOR_KEEP_ALIVE_LIMIT = 8;

interface Props {
  activePath: string | null;
  activeSessionId: string | null;
  dark: boolean;
  dirty: boolean;
  repositoryPath: string | null | undefined;
  saving: boolean;
  tabs: FileEditorTab[];
  onActivePathChange: (path: string) => void;
  onClosePanel: () => void;
  onCloseTab: (relativePath: string, event?: MouseEvent) => void;
  onReloadTab: (relativePath: string) => void;
  onSave: () => void;
  onTabContentChange: (relativePath: string, content: string) => void;
  mdPreviewByPath: Record<string, boolean>;
  onMdPreviewTabChange: (relativePath: string, value: boolean) => void;
  /** Ctrl/Cmd+Click import/export 路径时导航打开目标文件。 */
  onNavigateToFile?: (relativePath: string) => void;
  /** 在文件树中定位到指定文件（顶栏按钮 / tab 右键触发）。 */
  onRevealInExplorer?: (repositoryPath: string, relativePath: string) => void;
}

export function RepositoryFileEditorPanel({
  activePath,
  activeSessionId,
  dark,
  dirty,
  repositoryPath,
  saving,
  tabs,
  onActivePathChange,
  onClosePanel,
  onCloseTab,
  onReloadTab,
  onSave,
  onTabContentChange,
  mdPreviewByPath,
  onMdPreviewTabChange,
  onNavigateToFile,
  onRevealInExplorer,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.relativePath === activePath) ?? null;

  // LRU：活跃路径前插并截断至上限，决定哪些 tab 的 Monaco 实例保留（keep-alive）。
  // 切换 tab 时被逐出的 surface 收到 keepAlive=false，执行与卸载等价的清理。
  const [keepAlivePaths, setKeepAlivePaths] = useState<string[]>([]);
  useEffect(() => {
    if (!activePath) return;
    setKeepAlivePaths((prev) => {
      const next = [activePath, ...prev.filter((path) => path !== activePath)];
      if (next.length > FILE_EDITOR_KEEP_ALIVE_LIMIT) {
        next.length = FILE_EDITOR_KEEP_ALIVE_LIMIT;
      }
      return next;
    });
  }, [activePath]);

  const canSaveActiveTab = Boolean(
    activeTab?.relativePath &&
      !activeTab.loading &&
      activeTab.gitDiffSection !== "staged" &&
      !activeTab.gitCommitSha &&
      !activeTab.gitCommitCompare &&
      dirty &&
      !saving,
  );

  useEffect(() => {
    if (tabs.some((tab) => !tab.loading)) {
      void import("@monaco-editor/react");
    }
  }, [tabs]);

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key !== "s" && event.key !== "S" && event.code !== "KeyS") {
        return;
      }
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!canSaveActiveTab) {
        return;
      }
      onSave();
    }
    window.addEventListener("keydown", handleSaveShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleSaveShortcut, { capture: true });
  }, [canSaveActiveTab, onSave]);

  useEffect(() => {
    function handleCloseTabShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") {
        return;
      }
      if (!activePath || tabs.length === 0) {
        return;
      }
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseTab(activePath);
    }
    window.addEventListener("keydown", handleCloseTabShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleCloseTabShortcut, { capture: true });
  }, [activePath, onCloseTab, tabs.length]);

  const handleTabContentChange = useCallback(
    (relativePath: string, content: string) => {
      onTabContentChange(relativePath, content);
    },
    [onTabContentChange],
  );

  const revealTab = useCallback(
    (tab: FileEditorTab) => {
      if (!onRevealInExplorer || !tab.rootPath) return;
      onRevealInExplorer(tab.rootPath, tab.relativePath);
    },
    [onRevealInExplorer],
  );

  const buildTabContextMenuItems = useCallback(
    (tab: FileEditorTab): MenuProps["items"] => {
      return [
        {
          key: "reveal-in-explorer",
          label: "在文件树中定位",
          disabled: !onRevealInExplorer || !tab.rootPath,
          onClick: () => revealTab(tab),
        },
      ];
    },
    [onRevealInExplorer, revealTab],
  );

  /** 切换 tab 时让文件树跟随定位：切激活路径 + 触发 reveal（展开父目录链并滚动高亮）。
   *  revealFileInExplorer 会按当前布局算 revealTarget，文件树不可见时把侧栏切到文件 Tab
   *  并展开 section，再 reveal；可见时 requestExplorerFocus 为 no-op。 */
  const handleActivateTab = useCallback(
    (tab: FileEditorTab) => {
      onActivePathChange(tab.relativePath);
      revealTab(tab);
    },
    [onActivePathChange, revealTab],
  );

  return (
    <div ref={panelRef} className="app-file-editor-panel">
      <div className="app-file-editor-header">
        <div className="app-file-editor-tab-bar">
          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="已打开文件">
            {tabs.map((tab) => {
              const isActive = tab.relativePath === activePath;
              const tabDirty = tab.content !== tab.originalContent;
              const label = tab.relativePath.split(/[/\\]/).pop() ?? tab.relativePath;
              return (
                <Dropdown
                  key={tab.relativePath}
                  trigger={["contextMenu"]}
                  menu={{ items: buildTabContextMenuItems(tab) }}
                >
                  <div
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={0}
                    className={`app-file-editor-tab${isActive ? " app-file-editor-tab--active" : ""}`}
                    title={tab.relativePath}
                    onClick={() => handleActivateTab(tab)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleActivateTab(tab);
                      }
                    }}
                  >
                    <span className={`app-file-editor-tab-label${tabDirty ? " app-file-editor-tab-label--dirty" : ""}`}>
                      {label}
                    </span>
                    <button
                      type="button"
                      className="app-file-editor-tab-close"
                      aria-label={`关闭 ${label}`}
                      onClick={(event) => onCloseTab(tab.relativePath, event)}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                </Dropdown>
              );
            })}
          </div>
          <div className="app-file-editor-tab-bar-actions">
            {onRevealInExplorer ? (
              <HoverHint title="在文件树中定位">
                <Button
                  type="text"
                  size="small"
                  icon={<AimOutlined />}
                  aria-label="在文件树中定位"
                  disabled={!activeTab?.rootPath}
                  onClick={() => {
                    if (activeTab) revealTab(activeTab);
                  }}
                />
              </HoverHint>
            ) : null}
            {dirty ? <span className="app-file-editor-dirty app-file-editor-dirty--tab-bar">未保存</span> : null}
            <Button
              type="primary"
              size="small"
              onClick={onSave}
              loading={saving}
              disabled={!canSaveActiveTab}
            >
              保存
            </Button>
            <Button type="text" size="small" onClick={onClosePanel}>
              全部关闭
            </Button>
          </div>
        </div>
      </div>
      <div className="app-file-editor-body">
        {activeTab?.loading ? (
          <div className="app-file-editor-loading app-file-editor-loading--overlay">
            <Spin size="small" />
          </div>
        ) : null}
        {tabs
          .filter((tab) => !tab.loading)
          .map((tab) => (
            <RepositoryFileEditorTabSurface
              key={tab.relativePath}
              tab={tab}
              isActive={tab.relativePath === activePath}
              dark={dark}
              repositoryPath={repositoryPath}
              activeSessionId={activeSessionId}
              mdPreviewRequested={mdPreviewByPath[tab.relativePath] ?? false}
              onMdPreviewRequestedChange={(value) =>
                onMdPreviewTabChange(tab.relativePath, value)
              }
              onTabContentChange={handleTabContentChange}
              onCloseTab={onCloseTab}
              onReloadTab={onReloadTab}
              keepAlive={keepAlivePaths.includes(tab.relativePath)}
              onNavigateToFile={onNavigateToFile}
            />
          ))}
      </div>
    </div>
  );
}
