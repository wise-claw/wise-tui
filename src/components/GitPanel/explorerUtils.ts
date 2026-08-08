export function explorerTargetDirForCreate(selection: { path: string; isDir: boolean } | null): string {
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

export function readExplorerExpandedFromSession(repositoryPath: string): Set<string> | null {
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

export function writeExplorerExpandedToSession(repositoryPath: string, expanded: Set<string>): void {
  try {
    sessionStorage.setItem(explorerExpandedStorageKey(repositoryPath), JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / private mode */
  }
}

/** 右键菜单预估尺寸：用于首次落点钳制（渲染后再按实测微调）。 */
export const EXPLORER_CONTEXT_MENU_ESTIMATED_WIDTH_PX = 220;
export const EXPLORER_CONTEXT_MENU_ESTIMATED_HEIGHT_PX = 380;
export const EXPLORER_CONTEXT_MENU_VIEWPORT_PAD_PX = 8;

export function clampExplorerMenuPosition(
  clientX: number,
  clientY: number,
  size?: { width?: number; height?: number },
  viewport?: { width?: number; height?: number },
) {
  const menuW = Math.max(1, size?.width ?? EXPLORER_CONTEXT_MENU_ESTIMATED_WIDTH_PX);
  const menuH = Math.max(1, size?.height ?? EXPLORER_CONTEXT_MENU_ESTIMATED_HEIGHT_PX);
  const pad = EXPLORER_CONTEXT_MENU_VIEWPORT_PAD_PX;
  const viewportW =
    viewport?.width ?? (typeof window !== "undefined" ? window.innerWidth : menuW + pad * 2);
  const viewportH =
    viewport?.height ?? (typeof window !== "undefined" ? window.innerHeight : menuH + pad * 2);
  const maxX = Math.max(pad, viewportW - menuW - pad);
  const maxY = Math.max(pad, viewportH - menuH - pad);
  const x = Math.max(pad, Math.min(clientX, maxX));
  const y = Math.max(pad, Math.min(clientY, maxY));
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

export function isWordOfficeDocumentPath(path: string): boolean {
  const ext = explorerPathLeafExtension(path);
  return ext === "doc" || ext === "docx";
}

export function isMacLikePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return (
    navigator.userAgent.includes("Mac") || navigator.platform.toLowerCase().includes("mac")
  );
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}
