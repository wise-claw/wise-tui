import { useCallback, useMemo, useState, type ReactNode } from "react";
import { App, Popover, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { FolderOpenOutlined } from "@ant-design/icons";
import type { ProjectItem, Repository } from "../../types";
import {
  buildWorkspaceRepositoryTreeData,
  findProjectOwningRepository,
  formatWorkspaceRepositoryContextLabel,
  parseWorkspaceRepositoryTreeValue,
  resolveGitPanelContextOpenPath,
  resolveTreeNodeOpenPath,
  type WorkspaceRepositoryTreeNode,
  type WorkspaceRepositoryTreeSelection,
} from "../../utils/workspaceRepositoryTreeSelect";
import { IconFileTreeExplorer } from "../WorkspaceFileTreeRail/IconFileTreeExplorer";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { getDefaultTerminalActionIcon, getKnownOpenAppIcon } from "../OpenAppMenu/openAppIcons";
import {
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../../services/openWorkspaceWithPreference";
import { tryOpenWorkspaceInDefaultTerminal } from "../../services/openWorkspaceWithTerminalPreference";
import {
  repositoryEditorOpenMenuLabel,
  resolveEffectiveOpenAppId,
  resolveOpenAppTargetById,
} from "../../utils/openAppScope";
import {
  repositoryTerminalOpenMenuLabel,
  showRepositoryTerminalOpenMenuItem,
} from "../../utils/repositoryTerminalOpenMenu";

export interface GitPanelWorkspaceSelectorProps {
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  activeWorkspaceFocus: WorkspaceFocus;
  activeRepositoryPath: string;
  onRepositorySelect: (repositoryId: number) => void;
  onProjectSelect?: (projectId: string) => void;
  /** 仅切换文件树目录，不联动全局工作区（左栏文件 Tab）。 */
  directoryOnly?: boolean;
  /** 左栏 Git/文件面板当前树选择（优先于 active* 推导）。 */
  treeSelection?: WorkspaceRepositoryTreeSelection | null;
  /** 打开文件树栏并切换全局工作区 / 仓库会话（下拉行内快捷按钮）。 */
  onOpenFileTreeSession?: (target: WorkspaceRepositoryTreeSelection) => void;
}

interface TreeOpenActionsOptions {
  projects: ProjectItem[];
  repositories: Repository[];
  onOpenEditorPath: (path: string, scopeOpenAppId?: string | null) => void;
  onOpenFileTreeSession?: (target: WorkspaceRepositoryTreeSelection) => void;
  showTerminalOpen: boolean;
  terminalIconSrc: string;
  terminalActionLabel: string;
  onOpenTerminalPath: (path: string) => void;
}

function resolveTreeNodeFileTreeSessionTarget(
  node: WorkspaceRepositoryTreeNode,
): WorkspaceRepositoryTreeSelection | null {
  if (node.nodeType === "repo" && node.repositoryId != null) {
    return { kind: "repository", repositoryId: node.repositoryId };
  }
  if (node.nodeType === "project" && node.projectId) {
    return { kind: "project", projectId: node.projectId };
  }
  return null;
}

function buildTreeDataWithOpenActions(
  nodes: WorkspaceRepositoryTreeNode[],
  options: TreeOpenActionsOptions,
): DataNode[] {
  return nodes.map((node) => {
    const openPath = resolveTreeNodeOpenPath(node, options.projects, options.repositories);
    const scopeOpenAppId =
      node.nodeType === "repo" && node.repositoryId != null
        ? options.repositories.find((repo) => repo.id === node.repositoryId)?.openAppId
        : node.nodeType === "project" && node.projectId
          ? options.projects.find((project) => project.id === node.projectId)?.openAppId
          : undefined;
    const effectiveOpenAppId = resolveEffectiveOpenAppId(scopeOpenAppId);
    const editorTarget = resolveOpenAppTargetById(scopeOpenAppId);
    const editorActionLabel = editorTarget
      ? `在 ${editorTarget.label} 中打开`
      : repositoryEditorOpenMenuLabel(scopeOpenAppId);
    const editorIconSrc = getKnownOpenAppIcon(effectiveOpenAppId) ?? "";
    const fileTreeSessionTarget = resolveTreeNodeFileTreeSessionTarget(node);
    const showFileTreeSessionAction =
      fileTreeSessionTarget != null && options.onOpenFileTreeSession != null;
    const title: ReactNode = (
      <div className="git-panel-workspace-selector__tree-row">
        <span className="git-panel-workspace-selector__tree-label">{node.title}</span>
        {showFileTreeSessionAction || openPath ? (
          <div className="git-panel-workspace-selector__tree-actions">
            {showFileTreeSessionAction ? (
              <button
                type="button"
                className="git-panel-workspace-selector__tree-open git-panel-workspace-selector__tree-open--file-tree"
                title={`打开文件树并切换会话：${node.title}`}
                aria-label={`打开文件树并切换会话：${node.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  options.onOpenFileTreeSession?.(fileTreeSessionTarget);
                }}
              >
                <span
                  className="git-panel-workspace-selector__tree-open-icon git-panel-workspace-selector__tree-open-icon--svg"
                  aria-hidden
                >
                  <IconFileTreeExplorer />
                </span>
              </button>
            ) : null}
            {openPath ? (
              <button
                type="button"
                className="git-panel-workspace-selector__tree-open"
                title={`${editorActionLabel}：${node.title}`}
                aria-label={`${editorActionLabel}：${node.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  options.onOpenEditorPath(openPath, scopeOpenAppId);
                }}
              >
                <img
                  className="git-panel-workspace-selector__tree-open-icon"
                  src={editorIconSrc}
                  alt=""
                  aria-hidden
                />
              </button>
            ) : null}
            {openPath && options.showTerminalOpen ? (
              <button
                type="button"
                className="git-panel-workspace-selector__tree-open git-panel-workspace-selector__tree-open--terminal"
                title={`${options.terminalActionLabel}：${node.title}`}
                aria-label={`${options.terminalActionLabel}：${node.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  options.onOpenTerminalPath(openPath);
                }}
              >
                <img
                  className="git-panel-workspace-selector__tree-open-icon"
                  src={options.terminalIconSrc}
                  alt=""
                  aria-hidden
                />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );

    return {
      key: node.value,
      title,
      selectable: node.selectable,
      disabled: !node.selectable,
      children: node.children ? buildTreeDataWithOpenActions(node.children, options) : undefined,
    };
  });
}

export function GitPanelWorkspaceSelector({
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
  activeWorkspaceFocus,
  activeRepositoryPath,
  onRepositorySelect,
  onProjectSelect,
  directoryOnly = false,
  treeSelection = null,
  onOpenFileTreeSession,
}: GitPanelWorkspaceSelectorProps) {
  const { message } = App.useApp();
  const [pickerOpen, setPickerOpen] = useState(false);

  const terminalIconSrc = getDefaultTerminalActionIcon();
  const terminalActionLabel = repositoryTerminalOpenMenuLabel();
  const showTerminalOpen = showRepositoryTerminalOpenMenuItem();

  const handleOpenEditorPath = useCallback(
    (path: string, scopeOpenAppId?: string | null) => {
      void openWorkspaceWithStoredPreference(path, undefined, scopeOpenAppId).catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
        } else if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
          message.warning("目录路径为空");
        } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
          message.warning("未找到可用的打开方式");
        } else {
          message.error("编辑器打开失败");
          console.error(err);
        }
      });
    },
    [message],
  );

  const handleOpenTerminalPath = useCallback(
    (path: string) => {
      void tryOpenWorkspaceInDefaultTerminal(path).then((result) => {
        if (!result.ok) {
          message.warning(result.message);
        }
      });
    },
    [message],
  );

  const handleOpenFileTreeSession = useCallback(
    (target: WorkspaceRepositoryTreeSelection) => {
      onOpenFileTreeSession?.(target);
      setPickerOpen(false);
    },
    [onOpenFileTreeSession],
  );

  const treeNodes = useMemo(
    () => buildWorkspaceRepositoryTreeData(projects, repositories),
    [projects, repositories],
  );

  const antTreeData = useMemo(
    () =>
      buildTreeDataWithOpenActions(treeNodes, {
        projects,
        repositories,
        onOpenEditorPath: handleOpenEditorPath,
        onOpenFileTreeSession: onOpenFileTreeSession ? handleOpenFileTreeSession : undefined,
        showTerminalOpen,
        terminalIconSrc,
        terminalActionLabel,
        onOpenTerminalPath: handleOpenTerminalPath,
      }),
    [
      treeNodes,
      projects,
      repositories,
      handleOpenEditorPath,
      onOpenFileTreeSession,
      handleOpenFileTreeSession,
      showTerminalOpen,
      terminalIconSrc,
      terminalActionLabel,
      handleOpenTerminalPath,
    ],
  );

  const activeRepository = useMemo(
    () => repositories.find((item) => item.id === activeRepositoryId) ?? null,
    [repositories, activeRepositoryId],
  );

  const activeProject = useMemo(() => {
    if (activeProjectId) {
      const fromId = projects.find((item) => item.id === activeProjectId);
      if (fromId) return fromId;
    }
    if (activeRepositoryId != null) {
      return findProjectOwningRepository(projects, activeRepositoryId);
    }
    return null;
  }, [activeProjectId, activeRepositoryId, projects]);

  const contextLabel = formatWorkspaceRepositoryContextLabel(activeProject, activeRepository, {
    workspaceFocus: activeWorkspaceFocus,
  });

  const openPath = useMemo(
    () =>
      resolveGitPanelContextOpenPath({
        activeWorkspaceFocus,
        activeProject,
        activeRepositoryPath,
        repositories,
      }),
    [activeWorkspaceFocus, activeProject, activeRepositoryPath, repositories],
  );

  const selectedKeys = useMemo(() => {
    if (treeSelection?.kind === "project") {
      return [`project:${treeSelection.projectId}`];
    }
    if (treeSelection?.kind === "repository") {
      return [`repo:${treeSelection.repositoryId}`];
    }
    if (activeWorkspaceFocus === "project" && activeProjectId) {
      return [`project:${activeProjectId}`];
    }
    if (activeRepositoryId != null) {
      return [`repo:${activeRepositoryId}`];
    }
    return [];
  }, [treeSelection, activeWorkspaceFocus, activeProjectId, activeRepositoryId]);

  const picker = (
    <Tree
      className="git-panel-workspace-selector__tree"
      blockNode
      showLine
      defaultExpandAll
      selectedKeys={selectedKeys}
      treeData={antTreeData}
      onSelect={(keys) => {
        const raw = String(keys[0] ?? "");
        const parsed = parseWorkspaceRepositoryTreeValue(raw);
        if (!parsed) return;
        if (parsed.kind === "project") {
          onProjectSelect?.(parsed.projectId);
        } else {
          onRepositorySelect(parsed.repositoryId);
        }
        setPickerOpen(false);
      }}
    />
  );

  if (treeNodes.length === 0) {
    return (
      <span className="git-panel-workspace-selector__label" title={openPath || activeRepositoryPath}>
        {contextLabel}
      </span>
    );
  }

  return (
    <div className="git-panel-workspace-selector">
      <Popover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        trigger="click"
        placement="bottomLeft"
        overlayClassName="git-panel-workspace-selector__popover"
        content={picker}
      >
        <button
          type="button"
          className="git-panel-workspace-selector__trigger"
          title={openPath || activeRepositoryPath}
          aria-label={
            directoryOnly
              ? `当前目录：${contextLabel}，点击切换文件树目录`
              : `当前：${contextLabel}，点击切换工作区或仓库`
          }
          aria-expanded={pickerOpen}
        >
          <FolderOpenOutlined className="git-panel-workspace-selector__trigger-icon" aria-hidden />
          <span className="git-panel-workspace-selector__trigger-text">{contextLabel}</span>
        </button>
      </Popover>
    </div>
  );
}
