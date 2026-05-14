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

export function clampExplorerMenuPosition(clientX: number, clientY: number) {
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
