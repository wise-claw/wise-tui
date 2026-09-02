import type { DragEvent } from "react";

/** 「开发文件」树（文件/目录）拖到聊天输入框或文件树目录时使用的 DataTransfer MIME（非系统文件拖放）。 */
export const WISE_REPOSITORY_FILE_DRAG_MIME = "application/x-wise-repository-file";

export interface WiseRepositoryFileDragPayload {
  relativePath: string;
  isDir?: boolean;
}

let activeWiseRepositoryFileDrag: WiseRepositoryFileDragPayload | null = null;

function clearActiveWiseRepositoryFileDrag(): void {
  activeWiseRepositoryFileDrag = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("dragend", clearActiveWiseRepositoryFileDrag);
  }
}

/** dragover 读不到 getData，用 dragstart 写入的会话判断落点是否合法。 */
export function peekWiseRepositoryFileDrag(): WiseRepositoryFileDragPayload | null {
  return activeWiseRepositoryFileDrag;
}

/** 不设 `text/plain`：否则落到 Tiptap/可编辑区时浏览器会先插入纯路径，再与我们的 `@路径` 叠成重复。 */
export function setWiseRepositoryFileDragData(
  dataTransfer: DataTransfer,
  relativePath: string,
  options?: { isDir?: boolean },
): void {
  const trimmed = relativePath.trim();
  if (!trimmed) return;
  const payload: WiseRepositoryFileDragPayload = {
    relativePath: trimmed,
    isDir: options?.isDir === true,
  };
  dataTransfer.setData(WISE_REPOSITORY_FILE_DRAG_MIME, JSON.stringify(payload));
  // copy：拖到会话输入框；move：拖到文件树目录。
  dataTransfer.effectAllowed = "copyMove";
  activeWiseRepositoryFileDrag = payload;
  if (typeof window !== "undefined") {
    window.removeEventListener("dragend", clearActiveWiseRepositoryFileDrag);
    window.addEventListener("dragend", clearActiveWiseRepositoryFileDrag);
  }
}

export function isWiseRepositoryFileDragDataTransfer(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return [...dt.types].includes(WISE_REPOSITORY_FILE_DRAG_MIME);
}

export function isWiseRepositoryFileDrag(event: DragEvent): boolean {
  return isWiseRepositoryFileDragDataTransfer(event.dataTransfer);
}

export function parseWiseRepositoryFileDragPayload(raw: string): WiseRepositoryFileDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as WiseRepositoryFileDragPayload;
    const p = parsed.relativePath?.trim();
    if (!p) return null;
    return { relativePath: p, isDir: parsed.isDir === true };
  } catch {
    return null;
  }
}

/** 从拖放事件解析仓库内相对路径与是否目录（文件或目录）。 */
export function getWiseRepositoryFileDragPayload(event: DragEvent): WiseRepositoryFileDragPayload | null {
  const raw = event.dataTransfer.getData(WISE_REPOSITORY_FILE_DRAG_MIME);
  if (raw) {
    const parsed = parseWiseRepositoryFileDragPayload(raw);
    if (parsed) return parsed;
  }
  return peekWiseRepositoryFileDrag();
}

/** 从拖放事件解析仓库内相对路径（文件或目录）。 */
export function getWiseRepositoryFileDragPaths(event: DragEvent): string[] {
  const payload = getWiseRepositoryFileDragPayload(event);
  return payload ? [payload.relativePath] : [];
}
