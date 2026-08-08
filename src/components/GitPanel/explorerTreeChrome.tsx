import "@vscode/codicons/dist/codicon.css";
import {
  getIconForDirectoryPath,
  getIconForFilePath,
  getIconUrlByName,
  isMaterialIconName,
  type MaterialIcon,
} from "vscode-material-icons";

/** 与 Vite 插件挂载的静态路径一致（`/material-icons/*.svg`）。 */
export const MATERIAL_ICONS_BASE_URL = "/material-icons";

// ── Material Icon Theme helpers ──

export function resolveExplorerFileMaterialIcon(fileName: string): MaterialIcon {
  return getIconForFilePath(fileName.trim() || "file");
}

export function resolveExplorerFolderMaterialIcon(
  folderName: string,
  expanded: boolean,
): MaterialIcon {
  const closed = getIconForDirectoryPath(folderName.trim() || "folder");
  if (!expanded) {
    return closed;
  }
  if (closed === "folder") {
    return "folder-open";
  }
  if (closed.endsWith("-open")) {
    return closed;
  }
  const openName = `${closed}-open`;
  return isMaterialIconName(openName) ? openName : closed;
}

export function materialIconSrc(iconName: MaterialIcon): string {
  return getIconUrlByName(iconName, MATERIAL_ICONS_BASE_URL);
}

// ── Tree chrome (VS Code chevron + Material Icon Theme) ──

interface ExplorerTreeChevronProps {
  className?: string;
}

/** VS Code 资源管理器折叠箭头：codicon chevron-right，展开时由外层旋转 90° */
export function ExplorerTreeChevron({ className }: ExplorerTreeChevronProps) {
  return <span className={["codicon codicon-chevron-right", className].filter(Boolean).join(" ")} aria-hidden />;
}

interface ExplorerTreeFolderIconProps {
  name: string;
  expanded: boolean;
  className?: string;
}

export function ExplorerTreeFolderIcon({ name, expanded, className }: ExplorerTreeFolderIconProps) {
  const icon = resolveExplorerFolderMaterialIcon(name, expanded);
  return (
    <span className={["explorer-tree-folder-icon", className].filter(Boolean).join(" ")} aria-hidden>
      <img
        className="explorer-tree-material-icon"
        src={materialIconSrc(icon)}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

interface ExplorerTreeFileIconProps {
  fileName: string;
  className?: string;
}

export function ExplorerTreeFileIcon({ fileName, className }: ExplorerTreeFileIconProps) {
  const icon = resolveExplorerFileMaterialIcon(fileName);
  return (
    <span className={["explorer-tree-file-icon", className].filter(Boolean).join(" ")} aria-hidden>
      <img
        className="explorer-tree-material-icon"
        src={materialIconSrc(icon)}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

// ── Explorer toolbar actions (VS Code codicons) ──

type ExplorerToolbarCodicon =
  | "codicon-new-file"
  | "codicon-new-folder"
  | "codicon-refresh"
  | "codicon-collapse-all";

interface ExplorerToolbarCodiconProps {
  name: ExplorerToolbarCodicon;
  className?: string;
}

function ExplorerToolbarCodiconIcon({ name, className }: ExplorerToolbarCodiconProps) {
  return (
    <span
      className={["codicon", name, "explorer-toolbar-codicon", className].filter(Boolean).join(" ")}
      aria-hidden
    />
  );
}

export function ExplorerToolbarNewFileIcon({ className }: { className?: string } = {}) {
  return <ExplorerToolbarCodiconIcon name="codicon-new-file" className={className} />;
}

export function ExplorerToolbarNewFolderIcon({ className }: { className?: string } = {}) {
  return <ExplorerToolbarCodiconIcon name="codicon-new-folder" className={className} />;
}

export function ExplorerToolbarRefreshIcon({ className }: { className?: string } = {}) {
  return <ExplorerToolbarCodiconIcon name="codicon-refresh" className={className} />;
}

export function ExplorerToolbarCollapseAllIcon({ className }: { className?: string } = {}) {
  return <ExplorerToolbarCodiconIcon name="codicon-collapse-all" className={className} />;
}

import { isMacLikePlatform } from "./explorerUtils";

/** 右键菜单项：左侧文案 + 右侧快捷键（VS Code 风格） */
export function explorerContextMenuLabel(label: string, shortcut?: string) {
  if (!shortcut) {
    return label;
  }
  return (
    <span className="git-files-ctx-menu__row">
      <span className="git-files-ctx-menu__label">{label}</span>
      <span className="git-files-ctx-menu__shortcut">{shortcut}</span>
    </span>
  );
}

/** 当前平台修饰键符号，用于右键菜单快捷键展示。 */
export function explorerContextMenuModKey(): string {
  return isMacLikePlatform() ? "⌘" : "Ctrl+";
}

export function explorerContextMenuShiftModKey(): string {
  return isMacLikePlatform() ? "⇧⌘" : "Ctrl+Shift+";
}
