import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { CloseOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import { RepositoryFileEditorTabSurface } from "./RepositoryFileEditorTabSurface";
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
                <div
                  key={tab.relativePath}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={`app-file-editor-tab${isActive ? " app-file-editor-tab--active" : ""}`}
                  title={tab.relativePath}
                  onClick={() => onActivePathChange(tab.relativePath)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onActivePathChange(tab.relativePath);
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
              );
            })}
          </div>
          <div className="app-file-editor-tab-bar-actions">
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
            />
          ))}
      </div>
    </div>
  );
}
