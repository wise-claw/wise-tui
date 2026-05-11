import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { listen } from "@tauri-apps/api/event";
import type { InputRef } from "antd/es/input";
import type { MenuProps } from "antd";
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Menu,
  message,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckOutlined,
  DownOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
  MinusOutlined,
  ExclamationCircleOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  MinusSquareOutlined,
  VerticalAlignTopOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import {
  gitStatus,
  gitStage,
  gitUnstage,
  gitUnstageAll,
  gitCommit,
  gitPush,
  gitPull,
  gitFetch,
  gitDiscard,
  gitDiscardAll,
  gitLog,
  gitInit,
  startGitWatcher,
  stopGitWatcher,
} from "../../services/git";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import {
  createRepositoryDirectory,
  createRepositoryFile,
  deleteRepositoryEntry,
  listRepositoryExplorerEntries,
  type RepositoryExplorerEntry,
} from "../../services/repositoryFiles";
import { openInFinder, openWorkspaceIn } from "../../services/repository";
import type {
  GitFileStatus,
  GitLogEntry,
  GitPanelMode,
  GitStatusResponse,
} from "../../types";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import { joinRepositoryAbsolutePath } from "../../utils/repositoryPreviewBinary";
import { ExplorerTreeChevron, ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import "./index.css";

const { TextArea } = Input;
const { Text } = Typography;

// ── Utility ──

function getStatusSymbol(status: string): string {
  switch (status) {
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "R";
    case "T":
      return "T";
    default:
      return "?";
  }
}

function buildCommitDraftFromStatus(status: GitStatusResponse): string {
  const files = [...status.staged, ...status.unstaged];
  const topFiles = Array.from(new Set(files.map((item) => item.path))).slice(0, 4);
  const headline = files.length > 0 ? `更新代码变更，完善当前分支功能实现。` : "更新代码。";
  const scopeLine = topFiles.length > 0 ? `涉及：${topFiles.join("、")}` : "涉及：无变更文件";
  const statLine = `统计：+${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`;
  return [headline, scopeLine, statLine].join("\n");
}

function getStatusColor(status: string): string {
  switch (status) {
    case "A":
      return "#52c41a";
    case "M":
      return "#faad14";
    case "D":
      return "#ff4d4f";
    default:
      return "var(--ant-color-text-tertiary)";
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function splitPath(path: string) {
  const parts = path.split("/");
  if (parts.length === 1) return { name: path, dir: "" };
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

function splitNameAndExt(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, lastDot), ext: name.slice(lastDot + 1).toLowerCase() };
}

/** 让浏览器先完成一帧绘制，再开始可能较久的 Tauri 调用，避免点击后长时间没有加载反馈 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

// ── File Tree Types & Helpers ──

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  file?: GitFileStatus;
  additions: number;
  deletions: number;
  status: string;
}

type UnstagedViewMode = "tree" | "list";

function buildFileTree(files: GitFileStatus[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  for (const file of files) {
    const parts = file.path.split("/");
    let currentPath = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

      if (!dirMap.has(currentPath)) {
        const node: FileTreeNode = {
          name: parts[i],
          path: currentPath,
          isDir: true,
          children: [],
          additions: 0,
          deletions: 0,
          status: "M",
        };
        dirMap.set(currentPath, node);

        const parent = parentPath ? dirMap.get(parentPath) : null;
        if (parent) {
          parent.children!.push(node);
        } else {
          root.push(node);
        }
      }
    }

    const fileName = parts[parts.length - 1];
    const fileNode: FileTreeNode = {
      name: fileName,
      path: file.path,
      isDir: false,
      file,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    };

    const parentDir = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    const parent = parentDir ? dirMap.get(parentDir) : null;
    if (parent) {
      parent.children!.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  // Aggregate stats for directories
  function aggregate(node: FileTreeNode) {
    if (!node.children) return;
    for (const child of node.children) {
      aggregate(child);
      node.additions += child.additions;
      node.deletions += child.deletions;
    }
  }
  for (const node of root) {
    aggregate(node);
  }

  return root;
}

function DiscardFilePopconfirm({
  filePath,
  onConfirm,
  children,
}: {
  filePath: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <Popconfirm
      title="确认放弃更改？"
      description={
        <>
          <div>未暂存的修改将被永久丢弃，且无法恢复。</div>
          <div
            style={{
              marginTop: 8,
              wordBreak: "break-all",
              fontFamily: "var(--ant-font-family-code, monospace)",
              fontSize: 12,
            }}
          >
            {filePath}
          </div>
        </>
      }
      okText="放弃更改"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      placement="top"
      getPopupContainer={() => document.body}
      overlayInnerStyle={{ width: 300 }}
      onConfirm={onConfirm}
    >
      {children}
    </Popconfirm>
  );
}

/** 从「变更」列表打开时传入，用于内置 diff；资源管理器打开不传。 */
export type GitPanelOpenFileOptions = { fromGitChanges: "staged" | "unstaged" };

// ── File Tree Node Component ──

interface FileTreeNodeProps {
  node: FileTreeNode;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  depth: number;
}

function FileTreeNodeComponent({
  node,
  expandedDirs,
  onToggleDir,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
  depth,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);

  if (node.isDir) {
    return (
      <>
        <div
          className="git-tree-node git-tree-node--dir"
          style={{ paddingLeft: depth * 4 }}
        >
          <span
            className={`git-tree-node-arrow ${isExpanded ? "git-tree-node-arrow--expanded" : ""}`}
            onClick={() => onToggleDir(node.path)}
          >
            <ExplorerTreeChevron />
          </span>
          <ExplorerTreeFolderIcon
            name={node.name}
            expanded={isExpanded}
            className="git-tree-node-icon git-tree-node-icon--dir"
          />
          <span
            className="git-tree-node-name"
            onClick={() => onToggleDir(node.path)}
          >{node.name}</span>
          <Space size={0} className="git-tree-node-actions">
            <Tooltip title="暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onStage(node.path);
                }}
              />
            </Tooltip>
            <DiscardFilePopconfirm
              filePath={node.path}
              onConfirm={() => onDiscard(node.path)}
            >
              <Tooltip title="放弃更改" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<RevertIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              </Tooltip>
            </DiscardFilePopconfirm>
          </Space>
          <span className="git-tree-node-stats">
            <span className="git-file-add">+{node.additions}</span>
            <span className="git-file-sep">/</span>
            <span className="git-file-del">-{node.deletions}</span>
          </span>
        </div>
        {isExpanded && node.children && (
          <div className="git-tree-children">
            {node.children.map((child) => (
              <FileTreeNodeComponent
                key={child.path}
                node={child}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onStage={onStage}
                onUnstage={onUnstage}
                onDiscard={onDiscard}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  // File leaf node
  return (
    <div
      className={`git-tree-node git-tree-node--file${onOpenFile ? " git-tree-node--file--clickable" : ""}`}
    >
      {node.file && (
        <FileRow
          file={node.file}
          section="unstaged"
          onStage={onStage}
          onDiscard={onDiscard}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}

// ── Sub-components / SVG Icons ──

function RevertIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: 14, height: 14 }}
    >
      <path
        d="M3.5 5.5h6a3 3 0 0 1 0 6H7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 3.5L3.5 5.5L5.5 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── File Tree View ──

interface FileTreeViewProps {
  files: GitFileStatus[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function FileTreeView({
  files,
  expandedDirs,
  onToggleDir,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: FileTreeViewProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="git-file-list">
      {tree.map((node) => (
        <FileTreeNodeComponent
          key={node.path}
          node={node}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onOpenFile={onOpenFile}
          depth={0}
        />
      ))}
    </div>
  );
}

// ── Repository Files Explorer ──

interface RepositoryFileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: RepositoryFileTreeNode[];
}

function sortRepositoryTreeNodes(nodes: RepositoryFileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.children) {
      sortRepositoryTreeNodes(node.children);
    }
  }
}

/** 由后端返回的目录+文件条目构建资源管理器树（含空文件夹）。 */
function buildRepositoryFileTree(entries: RepositoryExplorerEntry[]): RepositoryFileTreeNode[] {
  const root: RepositoryFileTreeNode[] = [];
  const dirMap = new Map<string, RepositoryFileTreeNode>();

  function touchDirSegments(fullDirPath: string) {
    const parts = fullDirPath.split("/").filter(Boolean);
    let currentPath = "";
    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!dirMap.has(currentPath)) {
        const node: RepositoryFileTreeNode = {
          name: part,
          path: currentPath,
          isDir: true,
          children: [],
        };
        dirMap.set(currentPath, node);
        const parent = parentPath ? dirMap.get(parentPath) : null;
        if (parent) {
          parent.children!.push(node);
        } else {
          root.push(node);
        }
      }
    }
  }

  const sorted = [...entries].sort((a, b) => {
    const pc = a.path.localeCompare(b.path);
    if (pc !== 0) {
      return pc;
    }
    return a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1;
  });

  for (const e of sorted) {
    if (e.isDir) {
      touchDirSegments(e.path);
    }
  }

  for (const e of sorted) {
    if (e.isDir) {
      continue;
    }
    const parts = e.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    if (parentPath) {
      touchDirSegments(parentPath);
    }
    const fileName = parts[parts.length - 1];
    const fileNode: RepositoryFileTreeNode = {
      name: fileName,
      path: e.path,
      isDir: false,
    };
    const parent = parentPath ? dirMap.get(parentPath) : null;
    const list = parent ? parent.children! : root;
    if (!list.some((n) => n.path === e.path && !n.isDir)) {
      if (parent) {
        parent.children!.push(fileNode);
      } else {
        root.push(fileNode);
      }
    }
  }

  sortRepositoryTreeNodes(root);
  return root;
}

function collectDirectoryPaths(nodes: RepositoryFileTreeNode[], out: Set<string>) {
  for (const node of nodes) {
    if (!node.isDir) {
      continue;
    }
    out.add(node.path);
    if (node.children) {
      collectDirectoryPaths(node.children, out);
    }
  }
}

function filterRepositoryTree(
  nodes: RepositoryFileTreeNode[],
  query: string,
): RepositoryFileTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return nodes;
  }

  const filtered: RepositoryFileTreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      const children = filterRepositoryTree(node.children ?? [], q);
      const dirMatched = node.name.toLowerCase().includes(q);
      if (dirMatched || children.length > 0) {
        filtered.push({
          ...node,
          children,
        });
      }
      continue;
    }
    if (node.path.toLowerCase().includes(q)) {
      filtered.push(node);
    }
  }
  return filtered;
}

/** 新建文件/文件夹时的目标父目录（与 VS Code 资源管理器一致：选中文件夹则在其内；选中文件则在其父目录）。 */
function explorerTargetDirForCreate(selection: { path: string; isDir: boolean } | null): string {
  if (!selection) {
    return "";
  }
  if (selection.isDir) {
    return selection.path;
  }
  const slash = selection.path.lastIndexOf("/");
  return slash === -1 ? "" : selection.path.slice(0, slash);
}

function explorerExpandedStorageKey(repositoryPath: string): string {
  return `wise.repoExplorer.expanded.v1:${repositoryPath}`;
}

function readExplorerExpandedFromSession(repositoryPath: string): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(explorerExpandedStorageKey(repositoryPath));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

function writeExplorerExpandedToSession(repositoryPath: string, expanded: Set<string>) {
  try {
    sessionStorage.setItem(explorerExpandedStorageKey(repositoryPath), JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / private mode */
  }
}

function clampExplorerMenuPosition(clientX: number, clientY: number) {
  const menuW = 180;
  const menuH = 168;
  const pad = 8;
  const x = Math.max(pad, Math.min(clientX, window.innerWidth - menuW - pad));
  const y = Math.max(pad, Math.min(clientY, window.innerHeight - menuH - pad));
  return { x, y };
}

function explorerPathLeafExtension(path: string): string {
  const leaf = path.split("/").filter(Boolean).pop() ?? path;
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0 || dot === leaf.length - 1) {
    return "";
  }
  return leaf.slice(dot + 1).toLowerCase();
}

/** 是否可在资源管理器右键中提供「用 Word / WPS 等打开」的 Office 文档。 */
function isWordOfficeDocumentPath(path: string): boolean {
  const ext = explorerPathLeafExtension(path);
  return ext === "doc" || ext === "docx";
}

function isMacLikePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return (
    navigator.userAgent.includes("Mac") || navigator.platform.toLowerCase().includes("mac")
  );
}

function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

interface ExplorerContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

interface ExplorerInlineCreateState {
  type: "file" | "folder";
  parentDir: string;
  value: string;
}

interface ExplorerInlineCreateRowProps {
  depth: number;
  kind: "file" | "folder";
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function ExplorerInlineCreateRow({
  depth,
  kind,
  value,
  onChange,
  onCommit,
  onCancel,
}: ExplorerInlineCreateRowProps) {
  const inputRef = useRef<InputRef>(null);
  const skipBlurCommit = useRef(false);

  useLayoutEffect(() => {
    const el = inputRef.current?.input;
    if (el) {
      el.focus();
      el.select();
    }
  }, [kind, depth]);

  return (
    <div
      className="repo-tree-node repo-tree-node--inline-create"
      style={{ paddingLeft: depth * 4 }}
      data-repo-inline-create="1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {kind === "folder" ? (
        <ExplorerTreeFolderIcon name="" expanded={false} className="repo-tree-node-icon repo-tree-node-icon--dir" />
      ) : (
        <ExplorerTreeFileIcon fileName={value || "untitled"} className="repo-tree-node-icon repo-tree-node-icon--file" />
      )}
      <Input
        ref={inputRef}
        size="small"
        className="repo-tree-inline-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPressEnter={() => void onCommit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            skipBlurCommit.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false;
              return;
            }
            void onCommit();
          }, 0);
        }}
        aria-label={kind === "folder" ? "新建文件夹名称" : "新建文件名称"}
      />
    </div>
  );
}

interface RepositoryTreeNodeProps {
  node: RepositoryFileTreeNode;
  expandedDirs: Set<string>;
  selectedPath: string | null;
  onToggleDir: (dirPath: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  depth: number;
  onSelectNode: (path: string, isDir: boolean) => void;
  inlineCreate: ExplorerInlineCreateState | null;
  onInlineValueChange: (value: string) => void;
  onInlineCommit: () => void;
  onInlineCancel: () => void;
}

function RepositoryTreeNode({
  node,
  expandedDirs,
  selectedPath,
  onToggleDir,
  onOpenFile,
  depth,
  onSelectNode,
  inlineCreate,
  onInlineValueChange,
  onInlineCommit,
  onInlineCancel,
}: RepositoryTreeNodeProps) {
  if (node.isDir) {
    const expanded = expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;
    const showInlineHere = inlineCreate != null && inlineCreate.parentDir === node.path;
    const showChildren = expanded || showInlineHere;
    return (
      <>
        <div
          className={`repo-tree-node repo-tree-node--dir${isSelected ? " repo-tree-node--selected" : ""}${expanded ? " repo-tree-node--expanded" : ""}`}
          style={{ paddingLeft: depth * 4 }}
          data-repo-path={node.path}
          data-repo-is-dir="1"
          onClick={() => {
            onSelectNode(node.path, true);
            onToggleDir(node.path);
          }}
          role="treeitem"
          tabIndex={-1}
          aria-expanded={expanded}
        >
          <button
            type="button"
            className={`repo-tree-node-arrow ${expanded ? "repo-tree-node-arrow--expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectNode(node.path, true);
              onToggleDir(node.path);
            }}
            aria-label={expanded ? "收起目录" : "展开目录"}
          >
            <ExplorerTreeChevron />
          </button>
          <ExplorerTreeFolderIcon
            name={node.name}
            expanded={expanded}
            className="repo-tree-node-icon repo-tree-node-icon--dir"
          />
          <span className="repo-tree-node-name">{node.name}</span>
          {expanded ? <span className="repo-tree-node-branch-indicator" aria-hidden /> : null}
        </div>
        {showChildren && (
          <div className="repo-tree-children">
            {(node.children ?? []).map((childNode) => (
              <RepositoryTreeNode
                key={childNode.path}
                node={childNode}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                depth={depth + 1}
                onSelectNode={onSelectNode}
                inlineCreate={inlineCreate}
                onInlineValueChange={onInlineValueChange}
                onInlineCommit={onInlineCommit}
                onInlineCancel={onInlineCancel}
              />
            ))}
            {showInlineHere && inlineCreate ? (
              <ExplorerInlineCreateRow
                depth={depth + 1}
                kind={inlineCreate.type}
                value={inlineCreate.value}
                onChange={onInlineValueChange}
                onCommit={onInlineCommit}
                onCancel={onInlineCancel}
              />
            ) : null}
          </div>
        )}
      </>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <div
      className={`repo-tree-node repo-tree-node--file${onOpenFile ? " repo-tree-node--file--clickable" : ""}${isSelected ? " repo-tree-node--selected" : ""}`}
      style={{ paddingLeft: depth * 4 }}
      data-repo-path={node.path}
      data-repo-is-dir="0"
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, node.path);
      }}
      onClick={() => {
        onSelectNode(node.path, false);
        onOpenFile?.(node.path);
      }}
      role={onOpenFile ? "button" : undefined}
      tabIndex={onOpenFile ? 0 : -1}
      onKeyDown={(event) => {
        if (!onOpenFile) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenFile(node.path);
        }
      }}
    >
      <ExplorerTreeFileIcon fileName={node.name} className="repo-tree-node-icon repo-tree-node-icon--file" />
      <span className="repo-tree-file-name">{node.name}</span>
    </div>
  );
}

export interface RepositoryFilesExplorerProps {
  repositoryPath: string;
  repositoryLabel: string;
  search: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onClearExplorerSearch?: () => void;
  /** 与右栏 Claude Code 类似：收起后仅保留标题栏，点击仓库名展开 */
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
}

export function RepositoryFilesExplorer({
  repositoryPath,
  repositoryLabel,
  search,
  onOpenFile,
  onClearExplorerSearch,
  sectionCollapsed = false,
  onSectionCollapsedChange,
}: RepositoryFilesExplorerProps) {
  const [loading, setLoading] = useState(false);
  const [explorerEntries, setExplorerEntries] = useState<RepositoryExplorerEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null);
  const [inlineCreate, setInlineCreate] = useState<ExplorerInlineCreateState | null>(null);
  const [inlineRowKey, setInlineRowKey] = useState(0);
  const [explorerCtx, setExplorerCtx] = useState<ExplorerContextMenuState | null>(null);
  const [deletePop, setDeletePop] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
  } | null>(null);

  const tree = useMemo(() => buildRepositoryFileTree(explorerEntries), [explorerEntries]);
  const filteredTree = useMemo(() => filterRepositoryTree(tree, search), [tree, search]);

  const reloadExplorer = useCallback(
    async (options: { expandAll: boolean }) => {
      setLoading(true);
      try {
        await yieldToPaint();
        const entries = await listRepositoryExplorerEntries(repositoryPath);
        startTransition(() => {
          setExplorerEntries(entries);
        });
        if (options.expandAll) {
          const allDirs = new Set<string>();
          collectDirectoryPaths(buildRepositoryFileTree(entries), allDirs);
          setExpandedDirs(allDirs);
        }
      } finally {
        setLoading(false);
      }
    },
    [repositoryPath],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeExplorerExpandedToSession(repositoryPath, expandedDirs);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [repositoryPath, expandedDirs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await yieldToPaint();
        const entries = await listRepositoryExplorerEntries(repositoryPath);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setExplorerEntries(entries);
        });
        const restored = readExplorerExpandedFromSession(repositoryPath);
        setExpandedDirs(restored ?? new Set());
        setSelected(null);
        setInlineCreate(null);
        setDeletePop(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryPath]);

  useEffect(() => {
    if (!search.trim()) {
      return;
    }
    const matchedDirs = new Set<string>();
    collectDirectoryPaths(filteredTree, matchedDirs);
    setExpandedDirs((prev) => new Set([...prev, ...matchedDirs]));
  }, [search, filteredTree]);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    void reloadExplorer({ expandAll: false });
  }, [reloadExplorer]);

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  const handleExplorerContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-repo-inline-create]")) {
      return;
    }
    const row = (event.target as HTMLElement).closest("[data-repo-path]");
    if (!row) {
      return;
    }
    event.preventDefault();
    const path = row.getAttribute("data-repo-path") ?? "";
    const isDir = row.getAttribute("data-repo-is-dir") === "1";
    const { x, y } = clampExplorerMenuPosition(event.clientX, event.clientY);
    setExplorerCtx({ x, y, path, isDir });
  }, []);

  const performDeletePath = useCallback(
    async (relativePath: string): Promise<boolean> => {
      try {
        await deleteRepositoryEntry(repositoryPath, relativePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        message.error(`删除失败：${msg}`);
        return false;
      }
      await reloadExplorer({ expandAll: false });
      setSelected((prev) => {
        if (!prev) {
          return prev;
        }
        if (prev.path === relativePath || prev.path.startsWith(`${relativePath}/`)) {
          return null;
        }
        return prev;
      });
      setExpandedDirs((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === relativePath || p.startsWith(`${relativePath}/`)) {
            continue;
          }
          next.add(p);
        }
        return next;
      });
      message.success("已删除");
      return true;
    },
    [reloadExplorer, repositoryPath],
  );

  const expandAncestorsForDir = useCallback((parentDir: string) => {
    if (!parentDir) {
      return;
    }
    const parts = parentDir.split("/").filter(Boolean);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        next.add(acc);
      }
      return next;
    });
  }, []);

  const openInlineCreate = useCallback(
    (type: "file" | "folder", parentDir: string) => {
      if (search.trim()) {
        onClearExplorerSearch?.();
      }
      expandAncestorsForDir(parentDir);
      setInlineRowKey((k) => k + 1);
      setInlineCreate({
        type,
        parentDir,
        value: type === "file" ? "新文件.txt" : "新建文件夹",
      });
    },
    [expandAncestorsForDir, onClearExplorerSearch, search],
  );

  const explorerContextMenuItems = useMemo((): MenuProps["items"] => {
    const snap = explorerCtx;
    if (!snap) {
      return [];
    }
    const close = () => setExplorerCtx(null);
    const targetForCreate = explorerTargetDirForCreate({
      path: snap.path,
      isDir: snap.isDir,
    });

    const abs = joinRepositoryAbsolutePath(repositoryPath, snap.path);
    const tryOpenWithApp = (label: string, appName: string) => () => {
      close();
      void openWorkspaceIn(abs, { appName }).catch((e) => {
        message.error(`${label} 打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };
    const tryOpenWithCommand = (label: string, command: string, args: string[] = []) => () => {
      close();
      void openWorkspaceIn(abs, { command, args }).catch((e) => {
        message.error(`${label} 打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };
    const openWithDefaultApp = () => {
      close();
      void openInFinder(abs).catch((e) => {
        message.error(`打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };

    const standardItems: NonNullable<MenuProps["items"]> = [
      {
        key: "nf",
        label: "新建文件",
        onClick: () => {
          close();
          openInlineCreate("file", targetForCreate);
        },
      },
      {
        key: "nd",
        label: "新建文件夹",
        onClick: () => {
          close();
          openInlineCreate("folder", targetForCreate);
        },
      },
      { type: "divider" },
      {
        key: "del",
        label: "删除",
        danger: true,
        onClick: (info) => {
          const ev = info.domEvent;
          if (!("clientX" in ev)) {
            close();
            return;
          }
          close();
          setDeletePop({
            x: ev.clientX,
            y: ev.clientY,
            path: snap.path,
            isDir: snap.isDir,
          });
        },
      },
    ];

    const isWordFile = !snap.isDir && isWordOfficeDocumentPath(snap.path);
    if (!isWordFile) {
      return standardItems;
    }

    const mac = isMacLikePlatform();
    const win = isWindowsPlatform();
    let externalChildren: NonNullable<MenuProps["items"]>;
    if (mac) {
      externalChildren = [
        { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
        { type: "divider" },
        { key: "ext-wps", label: "WPS Office", onClick: tryOpenWithApp("WPS Office", "WPS Office") },
        {
          key: "ext-word",
          label: "Microsoft Word",
          onClick: tryOpenWithApp("Microsoft Word", "Microsoft Word"),
        },
        { key: "ext-pages", label: "Pages", onClick: tryOpenWithApp("Pages", "Pages") },
        { key: "ext-lo", label: "LibreOffice", onClick: tryOpenWithApp("LibreOffice", "LibreOffice") },
      ];
    } else if (win) {
      externalChildren = [
        { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
        { type: "divider" },
        { key: "ext-wps", label: "WPS Office", onClick: tryOpenWithApp("WPS Office", "wps") },
        {
          key: "ext-word",
          label: "Microsoft Word",
          onClick: tryOpenWithApp("Microsoft Word", "WINWORD"),
        },
      ];
    } else {
      externalChildren = [
        { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
        { type: "divider" },
        {
          key: "ext-lo",
          label: "LibreOffice",
          onClick: tryOpenWithCommand("LibreOffice", "libreoffice"),
        },
      ];
    }

    return [
      { key: "ext-root", label: "在外部应用中打开", children: externalChildren },
      { type: "divider" },
      ...standardItems,
    ];
  }, [explorerCtx, repositoryPath, openInlineCreate]);

  const cancelInlineCreate = useCallback(() => {
    setInlineCreate(null);
  }, []);

  const handleToolbarNewFile = useCallback(() => {
    openInlineCreate("file", explorerTargetDirForCreate(selected));
  }, [openInlineCreate, selected]);

  const handleToolbarNewFolder = useCallback(() => {
    openInlineCreate("folder", explorerTargetDirForCreate(selected));
  }, [openInlineCreate, selected]);

  const expandAncestorDirs = useCallback((relativePath: string, isDir: boolean) => {
    const parts = relativePath.split("/").filter(Boolean);
    const dirDepth = isDir ? parts.length : Math.max(0, parts.length - 1);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (let i = 0; i < dirDepth; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
        next.add(acc);
      }
      return next;
    });
  }, []);

  const inlineCreateRef = useRef<ExplorerInlineCreateState | null>(null);

  useEffect(() => {
    inlineCreateRef.current = inlineCreate;
  }, [inlineCreate]);

  const commitInlineCreate = useCallback(async () => {
    const cur = inlineCreateRef.current;
    if (!cur) {
      return;
    }
    const name = cur.value.trim();
    if (!name) {
      setInlineCreate(null);
      return;
    }
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      message.warning("名称不合法");
      return;
    }
    const relative = cur.parentDir ? `${cur.parentDir}/${name}` : name;
    try {
      if (cur.type === "file") {
        await createRepositoryFile(repositoryPath, relative);
      } else {
        await createRepositoryDirectory(repositoryPath, relative);
      }
      message.success("已创建");
      setInlineCreate(null);
      await reloadExplorer({ expandAll: false });
      expandAncestorDirs(relative, cur.type === "folder");
      setSelected({
        path: relative,
        isDir: cur.type === "folder",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`创建失败：${msg}`);
    }
  }, [expandAncestorDirs, reloadExplorer, repositoryPath]);

  const handleInlineValueChange = useCallback((value: string) => {
    setInlineCreate((prev) => (prev ? { ...prev, value } : null));
  }, []);

  const rootInline = inlineCreate?.parentDir === "";
  const treeEmpty = filteredTree.length === 0 && !rootInline;

  const setSectionCollapsed = onSectionCollapsedChange;

  if (sectionCollapsed && setSectionCollapsed) {
    return (
      <div className="git-files-mode git-files-mode--section-collapsed">
        <div className="git-files-explorer-bar">
          <Tooltip title="点击展开文件树" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="git-files-explorer-title git-files-explorer-title--toggle"
              title={repositoryPath}
              onClick={() => setSectionCollapsed(false)}
            >
              {repositoryLabel || "资源管理器"}
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  const treeBody = treeEmpty ? (
    <Empty
      description={search.trim() ? "未找到匹配文件" : "暂无文件"}
      style={{ padding: "24px 0" }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : (
    <div
      className="repo-tree-list"
      onContextMenu={handleExplorerContextMenu}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setSelected(null);
        }
      }}
    >
      {rootInline && inlineCreate ? (
        <ExplorerInlineCreateRow
          key={inlineRowKey}
          depth={0}
          kind={inlineCreate.type}
          value={inlineCreate.value}
          onChange={handleInlineValueChange}
          onCommit={() => void commitInlineCreate()}
          onCancel={cancelInlineCreate}
        />
      ) : null}
      {filteredTree.map((node) => (
        <RepositoryTreeNode
          key={node.path}
          node={node}
          expandedDirs={expandedDirs}
          selectedPath={selected?.path ?? null}
          onToggleDir={handleToggleDir}
          onOpenFile={onOpenFile}
          depth={0}
          onSelectNode={(path, isDir) => setSelected({ path, isDir })}
          inlineCreate={inlineCreate}
          onInlineValueChange={handleInlineValueChange}
          onInlineCommit={() => void commitInlineCreate()}
          onInlineCancel={cancelInlineCreate}
        />
      ))}
    </div>
  );

  return (
    <div className="git-files-mode">
      <div className="git-files-explorer-bar">
        {setSectionCollapsed ? (
          <Tooltip title="点击收起文件树" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="git-files-explorer-title git-files-explorer-title--toggle"
              title={repositoryPath}
              onClick={() => setSectionCollapsed(true)}
            >
              {repositoryLabel || "资源管理器"}
            </button>
          </Tooltip>
        ) : (
          <span className="git-files-explorer-title" title={repositoryPath}>
            {repositoryLabel || "资源管理器"}
          </span>
        )}
        <span className="git-files-explorer-actions">
          <Tooltip title="新建文件">
            <Button
              type="text"
              size="small"
              icon={<FileAddOutlined />}
              onClick={handleToolbarNewFile}
              aria-label="新建文件"
            />
          </Tooltip>
          <Tooltip title="新建文件夹">
            <Button
              type="text"
              size="small"
              icon={<FolderAddOutlined />}
              onClick={handleToolbarNewFolder}
              aria-label="新建文件夹"
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              aria-label="刷新"
            />
          </Tooltip>
          <Tooltip title="全部收起">
            <Button
              type="text"
              size="small"
              icon={<MinusSquareOutlined />}
              onClick={handleCollapseAll}
              aria-label="全部收起"
            />
          </Tooltip>
        </span>
      </div>
      <div className="git-files-explorer-scroll-region">
        {loading && explorerEntries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" description="加载文件中..." />
          </div>
        ) : (
          treeBody
        )}
      </div>
      {explorerCtx ? (
        <>
          <div
            className="git-files-ctx-backdrop"
            role="presentation"
            aria-hidden
            onMouseDown={() => setExplorerCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setExplorerCtx(null);
            }}
          />
          <Menu
            className="git-files-ctx-menu"
            classNames={{ popup: { root: "git-files-ctx-menu-popup" } }}
            style={{ position: "fixed", left: explorerCtx.x, top: explorerCtx.y, zIndex: 1050 }}
            selectable={false}
            items={explorerContextMenuItems}
          />
        </>
      ) : null}
      {deletePop ? (
        <Popconfirm
          open
          title="确认删除"
          description={
            <div className="git-files-delete-pop-desc">
              {deletePop.isDir ? (
                <p>
                  将<strong>递归删除</strong>该文件夹及其中的全部内容，且<strong>不可恢复</strong>。
                </p>
              ) : (
                <p>
                  将永久删除该文件，且<strong>不可恢复</strong>。
                </p>
              )}
              <p className="git-files-delete-pop-path">
                <code>{deletePop.path}</code>
              </p>
            </div>
          }
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          placement="bottomLeft"
          zIndex={1100}
          icon={<ExclamationCircleOutlined className="git-files-delete-pop-icon" aria-hidden />}
          getPopupContainer={() => document.body}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setDeletePop(null);
            }
          }}
          onConfirm={async () => {
            const ok = await performDeletePath(deletePop.path);
            if (ok) {
              setDeletePop(null);
            }
          }}
        >
          <span
            className="git-files-delete-pop-anchor"
            style={{
              position: "fixed",
              left: deletePop.x,
              top: deletePop.y,
              width: 1,
              height: 1,
              overflow: "hidden",
              pointerEvents: "none",
            }}
            aria-hidden
          />
        </Popconfirm>
      ) : null}
    </div>
  );
}

// ── Mode Options ──

const MODE_OPTIONS: { label: string; value: GitPanelMode; icon: React.ReactNode }[] = [
  { label: "变更", value: "diff", icon: <FileTextOutlined /> },
  { label: "日志", value: "log", icon: <HistoryOutlined /> },
];

// ── File Row ──

interface FileRowProps {
  file: GitFileStatus;
  section: "staged" | "unstaged";
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function FileRow({
  file,
  section,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: FileRowProps) {
  const { name } = splitPath(file.path);
  const { base, ext } = splitNameAndExt(name);

  return (
    <div
      className={`git-file-row ${onOpenFile ? "git-file-row--clickable" : ""}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, file.path);
      }}
      onClick={(e) => {
        if (!onOpenFile) {
          return;
        }
        // Tooltip / Popconfirm 会在按钮外包一层 DOM，仅靠子节点 stopPropagation 仍可能冒泡到行上
        if ((e.target as HTMLElement).closest(".git-file-actions")) {
          return;
        }
        onOpenFile(file.path, { fromGitChanges: section });
      }}
      role={onOpenFile ? "button" : undefined}
      tabIndex={onOpenFile ? 0 : -1}
      onKeyDown={(event) => {
        if (!onOpenFile) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenFile(file.path, { fromGitChanges: section });
        }
      }}
    >
      <span
        className="git-file-status-badge"
        style={{ color: getStatusColor(file.status) }}
      >
        {getStatusSymbol(file.status)}
      </span>
      <div className="git-file-info">
        <span className="git-file-name">
          {base}
          {ext && <span className="git-file-ext">.{ext}</span>}
        </span>
      </div>
      <div className="git-file-meta">
        <Space
          size={0}
          className="git-file-actions"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {section === "unstaged" && onStage && (
            <Tooltip title="暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onStage(file.path);
                }}
              />
            </Tooltip>
          )}
          {section === "staged" && onUnstage && (
            <Tooltip title="取消暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<span style={{ fontSize: 12 }}>-</span>}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnstage(file.path);
                }}
              />
            </Tooltip>
          )}
          {section === "unstaged" && onDiscard && (
            <DiscardFilePopconfirm
              filePath={file.path}
              onConfirm={() => onDiscard(file.path)}
            >
              <Tooltip title="放弃更改" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<RevertIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              </Tooltip>
            </DiscardFilePopconfirm>
          )}
        </Space>
        <span className="git-file-counts">
          <span className="git-file-add">+{file.additions}</span>
          <span className="git-file-sep">/</span>
          <span className="git-file-del">-{file.deletions}</span>
        </span>
      </div>
    </div>
  );
}

// ── Diff Mode ──

interface DiffModeProps {
  repositoryPath: string;
  status: GitStatusResponse;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void | Promise<void>;
  onCommit: (msg: string) => void;
  onPush: () => void;
  onPull: () => void;
  onFetch: () => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function DiffMode({
  repositoryPath,
  status,
  loading,
  errors,
  onStage,
  onUnstage,
  onDiscard,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
  onCommit,
  onPush,
  onPull,
  onFetch,
  onOpenFile,
}: DiffModeProps) {
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const [commitMsg, setCommitMsg] = useState("");
  const [unstagedViewMode, setUnstagedViewMode] = useState<UnstagedViewMode>("tree");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeAllExpanded, setTreeAllExpanded] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const hasStaged = status.staged.length > 0;
  const hasUnstaged = status.unstaged.length > 0;
  const hasChanges = hasStaged || hasUnstaged;
  const canCommit = commitMsg.trim().length > 0 && hasChanges && !loading.commit;

  const unstagedDirPaths = useMemo(() => {
    if (unstagedViewMode !== "tree") return [];
    const dirs: string[] = [];
    const tree = buildFileTree(status.unstaged);
    function collect(node: FileTreeNode) {
      if (node.isDir) {
        dirs.push(node.path);
        node.children?.forEach(collect);
      }
    }
    tree.forEach(collect);
    return dirs;
  }, [status.unstaged, unstagedViewMode]);

  const handleExpandAll = useCallback(() => {
    setExpandedDirs(new Set(unstagedDirPaths));
    setTreeAllExpanded(true);
  }, [unstagedDirPaths]);

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set());
    setTreeAllExpanded(false);
  }, []);

  const handleToggleTree = useCallback(() => {
    if (treeAllExpanded) {
      handleCollapseAll();
    } else {
      handleExpandAll();
    }
  }, [treeAllExpanded, handleCollapseAll, handleExpandAll]);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const handleGenerateCommitByAi = useCallback(async () => {
    if (aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const fallback = buildCommitDraftFromStatus(status);
      const files = [...status.staged, ...status.unstaged]
        .map((f) => `- ${f.path} (${f.status}, +${f.additions}, -${f.deletions})`)
        .join("\n");
      const model = await getClaudeConfigModel(repositoryPath);
      const result = await executeClaudeCodeAndWait({
        repositoryPath,
        prompt: [
          "你是资深工程师，请根据 git 变更生成可直接提交的中文 commit message。",
          "要求：1-3 行，简洁专业，仅输出提交信息正文，不要解释。",
          "",
          `分支: ${status.branch ?? "unknown"}`,
          `统计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存数量: ${status.staged.length}, 未暂存数量: ${status.unstaged.length}`,
          "文件列表：",
          files || "- 无",
        ].join("\n"),
        model: model ?? undefined,
        timeoutMs: 45_000,
        connectionMode: "oneshot",
      });
      if (!result.success) {
        setCommitMsg(fallback);
        message.warning("AI 生成失败，已填充默认提交信息。");
        return;
      }
      const text = extractClaudeInvocationFinalText(result.outputLines);
      setCommitMsg(text || fallback);
    } catch {
      setCommitMsg(buildCommitDraftFromStatus(status));
      message.warning("AI 生成失败，已填充默认提交信息。");
    } finally {
      setAiSummaryLoading(false);
    }
  }, [aiSummaryLoading, repositoryPath, status]);

  return (
    <div className="git-diff-mode">
      {/* Error dismiss */}
      {errors.commit && (
        <div className="git-error-banner">
          <Text type="danger" style={{ fontSize: 12 }}>{errors.commit}</Text>
          <Button
            type="text"
            size="small"
            icon={<span style={{ fontSize: 14 }}>&times;</span>}
            onClick={() => { }}
          />
        </div>
      )}

      {/* Sync controls */}
      {(status.branch || loading.fetch) && (
        <div className="git-sync-row">
          <div className="git-branch-info">
            <Tooltip title={`当前分支：${status.branch || "unknown"}`} placement="topLeft">
              <Button
                type="text"
                size="small"
                className="git-ai-summary-btn"
                onClick={() => void handleGenerateCommitByAi()}
                loading={aiSummaryLoading}
              >
                AI 生成信息
              </Button>
            </Tooltip>
          </div>
          <Space size={2} className="git-sync-row-actions">
            <Tooltip title="获取远程" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={<ReloadOutlined spin={loading.fetch} />}
                onClick={onFetch}
                disabled={loading.fetch}
              />
            </Tooltip>
            <Tooltip title="拉取" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={loading.pull ? <ReloadOutlined spin /> : <ArrowDownOutlined />}
                onClick={onPull}
                disabled={loading.pull || loading.fetch}
              >
                {!loading.pull && behind > 0 && (
                  <span className="sync-count sync-count--behind">{behind}</span>
                )}
              </Button>
            </Tooltip>
            <Tooltip title="推送" placement="top">
              <Button
                type="text"
                size="small"
                className="git-sync-count-btn"
                icon={loading.push ? <ReloadOutlined spin /> : <ArrowUpOutlined />}
                onClick={onPush}
                disabled={loading.push || loading.pull}
              >
                {!loading.push && ahead > 0 && (
                  <span className="sync-count sync-count--ahead">{ahead}</span>
                )}
              </Button>
            </Tooltip>
            {status.staged.length > 0 && (
              <Tooltip title="待提交" placement="top">
                <Button
                  type="text"
                  size="small"
                  className="git-sync-count-btn"
                  icon={<CheckOutlined />}
                  disabled
                >
                  <span className="sync-count sync-count--staged">{status.staged.length}</span>
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>
      )}

      {/* Commit section */}
      {hasChanges && (
        <div className="git-commit-section">
          <TextArea
            className="git-commit-input"
            placeholder="提交信息..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            type="primary"
            block
            className="git-commit-btn"
            onClick={() => {
              if (canCommit) {
                onCommit(commitMsg);
                setCommitMsg("");
              }
            }}
            disabled={!canCommit}
            loading={loading.commit}
            icon={<CheckOutlined />}
          >
            {loading.commit ? "提交中..." : "提交"}
          </Button>
        </div>
      )}

      {/* Diff summary */}
      {status.branch && (hasStaged || hasUnstaged) && (
        <div className="git-push-section">
          <Space size={2}>
            <Text style={{ fontSize: 11, color: '#8b8b8b' }}>合计:</Text>
            <Text style={{ fontSize: 11, color: "#52c41a" }}>
              +{status.additions}
            </Text>
            <Text style={{ fontSize: 11, color: '#8b8b8b' }}>/</Text>
            <Text style={{ fontSize: 11, color: "#ff4d4f" }}>
              -{status.deletions}
            </Text>
          </Space>
          {hasUnstaged && (
            <span className="git-view-toggle">
              <Button
                type={unstagedViewMode === "tree" ? "primary" : "text"}
                size="small"
                icon={<ApartmentOutlined />}
                onClick={() => setUnstagedViewMode("tree")}
                style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
              />
              <Button
                type={unstagedViewMode === "list" ? "primary" : "text"}
                size="small"
                icon={<UnorderedListOutlined />}
                onClick={() => setUnstagedViewMode("list")}
                style={{ width: 24, height: 20, padding: 0, fontSize: 11 }}
              />
            </span>
          )}
        </div>
      )}

      {/* Staged files */}
      {hasStaged && (
        <div className="git-section">
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              已暂存 ({status.staged.length})
            </Text>
            <Tooltip title="全部取消暂存" placement="topRight">
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                onClick={onUnstageAll}
                disabled={loading.unstageAll || loading.stageAll}
                style={{ width: 24, height: 20, padding: 0 }}
              />
            </Tooltip>
          </div>
          <div className="git-file-list">
            {status.staged.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                section="staged"
                onUnstage={onUnstage}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unstaged files */}
      {hasUnstaged && (
        <div className="git-section">
          <div className="git-section-header">
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
              更改 ({status.unstaged.length})
            </Text>
            <Space size={4}>
              {unstagedViewMode === "tree" && (
                <Tooltip title={treeAllExpanded ? "收起" : "展开"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    icon={treeAllExpanded ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
                    onClick={handleToggleTree}
                    style={{ width: 24, height: 20, padding: 0 }}
                  />
                </Tooltip>
              )}
              <Tooltip title="全部暂存" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={onStageAll}
                  disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                  style={{ width: 24, height: 20, padding: 0 }}
                />
              </Tooltip>
              <Popconfirm
                title="确认放弃全部更改？"
                description="所有未暂存的本地修改将被永久丢弃，此操作不可恢复。"
                okText="全部放弃"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                placement="bottomRight"
                getPopupContainer={() => document.body}
                overlayInnerStyle={{ width: 300 }}
                disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                onConfirm={onDiscardAll}
              >
                <Tooltip title="放弃全部更改" placement="topRight">
                  <Button
                    type="text"
                    size="small"
                    icon={<RevertIcon />}
                    disabled={loading.stageAll || loading.unstageAll || loading.discardAll}
                    style={{ width: 24, height: 20, padding: 0 }}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          </div>
          {unstagedViewMode === "tree" ? (
            <FileTreeView
              files={status.unstaged}
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              onOpenFile={onOpenFile}
            />
          ) : (
            <div className="git-file-list">
              {status.unstaged.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  section="unstaged"
                  onStage={onStage}
                  onDiscard={onDiscard}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasChanges && status.branch && (
        <Empty description="没有检测到变更" style={{ padding: "24px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
}

// ── Log Mode ──

interface LogModeProps {
  entries: GitLogEntry[];
  loading: boolean;
  ahead: number;
  behind: number;
  upstream: string | null;
}

function LogMode({ entries, loading, ahead, behind, upstream }: LogModeProps) {
  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}><Spin size="small" description="加载中..." /></div>;
  }

  if (entries.length === 0) {
    return <Empty description="暂无提交记录" style={{ padding: "24px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="git-log-mode">
      {upstream && (ahead > 0 || behind > 0) && (
        <div className="git-log-sync-info">
          <div className="git-log-sync-stats">
            <Tag color="default" className="git-log-upstream-tag">
              {upstream}
            </Tag>
            {ahead > 0 && (
              <span className="git-log-stat git-log-stat--ahead">
                ↑{ahead}
              </span>
            )}
            {behind > 0 && (
              <span className="git-log-stat git-log-stat--behind">
                ↓{behind}
              </span>
            )}
          </div>
        </div>
      )}

      {ahead > 0 && entries.length > 0 && (
        <div className="git-log-section">
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>待推送</Text>
          <div className="git-log-list">
            {entries.slice(0, ahead).map((entry) => (
              <LogEntry key={entry.sha} entry={entry} />
            ))}
          </div>
        </div>
      )}

      <div className="git-log-section">
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>最近提交</Text>
        <div className="git-log-list">
          {entries.map((entry) => (
            <LogEntry key={entry.sha} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ entry }: { entry: GitLogEntry }) {
  return (
    <div className="git-log-entry">
      <div className="git-log-summary">{entry.summary || "无描述"}</div>
      <div className="git-log-meta">
        <Tag
          color="blue"
          style={{
            fontSize: 9,
            padding: "0 3px",
            lineHeight: "14px",
            borderRadius: 2,
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          }}
        >
          {entry.sha.slice(0, 7)}
        </Tag>
        <Text type="secondary" style={{ fontSize: 10 }}>{entry.author || "未知"}</Text>
        <Text type="secondary" style={{ fontSize: 10 }}>{formatRelativeTime(entry.timestamp)}</Text>
      </div>
    </div>
  );
}

// ── Init Mode (no git repo) ──

interface InitModeProps {
  onInit: () => void;
  loading: boolean;
}

function InitMode({ onInit, loading }: InitModeProps) {
  return (
    <div className="git-init-mode">
      <InboxOutlined style={{ fontSize: 32, color: "var(--ant-color-text-tertiary)" }} />
      <Text type="secondary" style={{ fontSize: 13 }}>此项目尚未初始化 Git 仓库</Text>
      <Button
        type="primary"
        size="middle"
        onClick={onInit}
        loading={loading}
        icon={<PlusOutlined />}
      >
        {loading ? "初始化中..." : "初始化 Git"}
      </Button>
    </div>
  );
}

// ── Main GitPanel ──

interface Props {
  repositoryPath: string | undefined;
  repositoryName: string | undefined;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function GitPanel({ repositoryPath, repositoryName: _repositoryName, onOpenFile }: Props) {
  const [mode, setMode] = useState<GitPanelMode>("diff");
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [logData, setLogData] = useState<{
    entries: GitLogEntry[];
    ahead: number;
    behind: number;
    upstream: string | null;
  }>({ entries: [], ahead: 0, behind: 0, upstream: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({
    status: false,
    log: false,
    stage: false,
    unstage: false,
    commit: false,
    push: false,
    pull: false,
    fetch: false,
    discard: false,
    stageAll: false,
    unstageAll: false,
    discardAll: false,
    init: false,
  });

  // Debounce: track running actions and last trigger time
  const runningActions = useRef(new Set<string>());
  const lastActionTime = useRef(new Map<string, number>());
  const watcherRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 400;
  const WATCHER_REFRESH_MS = 120;

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading((prev) => ({ ...prev, status: true }));
    }
    try {
      const result = await gitStatus(repositoryPath);
      const apply = () => {
        setStatus(result);
        setErrors((prev) => {
          const next = { ...prev };
          delete next.status;
          return next;
        });
      };
      if (silent) {
        startTransition(apply);
      } else {
        apply();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const applyErr = () => {
        setErrors((prev) => ({ ...prev, status: msg }));
        setStatus(null);
      };
      if (silent) {
        startTransition(applyErr);
      } else {
        applyErr();
      }
    } finally {
      if (!silent) {
        setLoading((prev) => ({ ...prev, status: false }));
      }
    }
  }, [repositoryPath]);

  const loadLog = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading((prev) => ({ ...prev, log: true }));
    }
    try {
      const result = await gitLog(repositoryPath, 20);
      const apply = () => {
        setLogData({
          entries: result.entries,
          ahead: result.ahead,
          behind: result.behind,
          upstream: result.upstream,
        });
      };
      if (silent) {
        startTransition(apply);
      } else {
        apply();
      }
    } catch {
      // Silently fail for log
    } finally {
      if (!silent) {
        setLoading((prev) => ({ ...prev, log: false }));
      }
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (repositoryPath) {
      loadStatus();
      if (mode === "log") {
        loadLog();
      }
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

  // Manage file watcher: start watching when repositoryPath changes, stop when it changes away
  useEffect(() => {
    if (!repositoryPath) {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
        watcherRefreshTimer.current = null;
      }
      stopGitWatcher().catch(() => { });
      return;
    }

    startGitWatcher(repositoryPath).catch(() => { });

    const unlisten = listen("git-changed", () => {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
      }
      watcherRefreshTimer.current = setTimeout(() => {
        watcherRefreshTimer.current = null;
        void loadStatus({ silent: true });
        if (mode === "log") {
          void loadLog({ silent: true });
        }
      }, WATCHER_REFRESH_MS);
    });

    return () => {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
        watcherRefreshTimer.current = null;
      }
      unlisten.then((fn) => fn());
      stopGitWatcher().catch(() => { });
    };
  }, [repositoryPath, mode, loadStatus, loadLog]);

  const runAction = useCallback(
    async (
      action: string,
      fn: () => Promise<void>,
      options?: { successMessage?: string },
    ) => {
      const now = Date.now();
      const lastTime = lastActionTime.current.get(action) || 0;

      // Debounce: skip if same action was triggered recently
      if (now - lastTime < DEBOUNCE_MS) return;

      // Prevent concurrent execution of the same action
      if (runningActions.current.has(action)) return;

      runningActions.current.add(action);
      lastActionTime.current.set(action, now);
      setLoading((prev) => ({ ...prev, [action]: true }));

      try {
        await yieldToPaint();
        await fn();
        await loadStatus({ silent: true });
        if (mode === "log") {
          await loadLog({ silent: true });
        }
        setErrors((prev) => {
          if (!prev[action]) return prev;
          const next = { ...prev };
          delete next[action];
          return next;
        });
        if (options?.successMessage) {
          message.success(options.successMessage);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => ({ ...prev, [action]: msg }));
      } finally {
        runningActions.current.delete(action);
        setLoading((prev) => ({ ...prev, [action]: false }));
      }
    },
    [mode, loadStatus, loadLog],
  );

  const handleStage = useCallback(
    (filePath: string) => runAction("stage", () => gitStage(repositoryPath!, filePath)),
    [repositoryPath, runAction],
  );

  const handleUnstage = useCallback(
    (filePath: string) =>
      runAction("unstage", () => gitUnstage(repositoryPath!, filePath)),
    [repositoryPath, runAction],
  );

  const handleDiscard = useCallback(
    (filePath: string) =>
      runAction("discard", () => gitDiscard(repositoryPath!, filePath)),
    [repositoryPath, runAction],
  );

  const handleStageAll = useCallback(() => {
    runAction("stageAll", async () => {
      if (!status) return;
      for (const f of status.unstaged) {
        await gitStage(repositoryPath!, f.path);
      }
    });
  }, [repositoryPath, status, runAction]);

  const handleUnstageAll = useCallback(() => {
    runAction("unstageAll", async () => {
      if (!repositoryPath) return;
      await gitUnstageAll(repositoryPath);
    });
  }, [repositoryPath, runAction]);

  const handleDiscardAll = useCallback(
    () =>
      runAction("discardAll", async () => {
        if (!repositoryPath) return;
        await gitDiscardAll(repositoryPath);
      }),
    [repositoryPath, runAction],
  );

  const handleCommit = useCallback(
    (msg: string) =>
      runAction(
        "commit",
        async () => {
          await gitCommit(repositoryPath!, msg);
        },
        { successMessage: "提交成功" },
      ),
    [repositoryPath, runAction],
  );

  const handlePush = useCallback(async () => {
    if (runningActions.current.has("push")) return;
    runningActions.current.add("push");
    setLoading((prev) => ({ ...prev, push: true }));
    try {
      await yieldToPaint();
      await gitPush(repositoryPath!);
      await loadStatus({ silent: true });
      if (mode === "log") {
        await loadLog({ silent: true });
      }
      message.success("推送成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`推送失败: ${msg}`);
    } finally {
      runningActions.current.delete("push");
      setLoading((prev) => ({ ...prev, push: false }));
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

  const handlePull = useCallback(async () => {
    if (runningActions.current.has("pull")) return;
    runningActions.current.add("pull");
    setLoading((prev) => ({ ...prev, pull: true }));
    try {
      await yieldToPaint();
      await gitPull(repositoryPath!);
      await loadStatus({ silent: true });
      if (mode === "log") {
        await loadLog({ silent: true });
      }
      message.success("拉取成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`拉取失败: ${msg}`);
    } finally {
      runningActions.current.delete("pull");
      setLoading((prev) => ({ ...prev, pull: false }));
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

  const handleFetch = useCallback(
    () => runAction("fetch", () => gitFetch(repositoryPath!)),
    [repositoryPath, runAction],
  );

  const handleInit = useCallback(() => {
    runAction("init", async () => {
      if (!repositoryPath) return;
      await gitInit(repositoryPath);
    });
  }, [repositoryPath, runAction]);

  const isMissingRepo = errors.status?.includes("Failed to open git repo");

  const anyLoading = Object.values(loading).some(Boolean);

  const modeIcon = useMemo(() => {
    const opt = MODE_OPTIONS.find((option) => option.value === mode);
    return opt?.icon;
  }, [mode]);

  if (!repositoryPath) {
    return (
      <div className="app-git-panel">
        <Empty description="请选择仓库以查看 Git 状态" style={{ padding: "40px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="app-git-panel">
      {/* Loading Bar */}
      <div className={`git-panel-loading-bar ${anyLoading ? "git-panel-loading-bar--active" : ""}`} />

      {/* Header */}
      <div className="git-panel-header" data-tauri-drag-region>
        <div className="git-panel-header-left">
          {status && (
            <Tag
              color={mode === "diff" ? "blue" : mode === "log" ? "green" : "default"}
              style={{ fontSize: 10, padding: "0 5px", lineHeight: "16px", borderRadius: 3 }}
            >
              {mode === "diff"
                ? `${status.staged.length + status.unstaged.length} 个变更`
                : mode === "log"
                  ? `${logData.entries.length} 条记录`
                  : mode === "issues"
                    ? "Issues"
                    : "PRs"}
            </Tag>
          )}
        </div>
        <Dropdown
          menu={{
            items: MODE_OPTIONS.map((option) => ({
              key: option.value,
              label: (
                <Space size={6}>
                  {option.icon}
                  {option.label}
                </Space>
              ),
            })),
            onClick: ({ key }) => setMode(key as GitPanelMode),
            selectedKeys: [mode],
          }}
          placement="bottomRight"
          trigger={["click"]}
        >
          <Button type="text" size="small" icon={modeIcon} className="git-mode-btn">
            <span className="git-mode-btn-text">{mode === "diff" ? "变更" : "日志"}</span>
            <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
      </div>

      {/* Content */}
      {loading.status && !status && !isMissingRepo ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin size="small" description="加载中..." />
        </div>
      ) : isMissingRepo ? (
        <InitMode onInit={handleInit} loading={loading.init} />
      ) : mode === "diff" ? (
        status && (
          <DiffMode
            repositoryPath={repositoryPath}
            status={status}
            loading={loading}
            errors={errors}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onDiscard={handleDiscard}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
            onDiscardAll={handleDiscardAll}
            onCommit={handleCommit}
            onPush={handlePush}
            onPull={handlePull}
            onFetch={handleFetch}
            onOpenFile={onOpenFile}
          />
        )
      ) : mode === "log" ? (
        <LogMode
          entries={logData.entries}
          loading={loading.log}
          ahead={logData.ahead}
          behind={logData.behind}
          upstream={logData.upstream}
        />
      ) : (
        status && (
          <DiffMode
            repositoryPath={repositoryPath}
            status={status}
            loading={loading}
            errors={errors}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onDiscard={handleDiscard}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
            onDiscardAll={handleDiscardAll}
            onCommit={handleCommit}
            onPush={handlePush}
            onPull={handlePull}
            onFetch={handleFetch}
            onOpenFile={onOpenFile}
          />
        )
      )}
    </div>
  );
}
