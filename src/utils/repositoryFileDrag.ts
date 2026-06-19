import type { DragEvent } from "react";

/** 「开发文件」树（文件/目录）拖到聊天输入框时使用的 DataTransfer MIME（非系统文件拖放）。 */
export const WISE_REPOSITORY_FILE_DRAG_MIME = "application/x-wise-repository-file";

export interface WiseRepositoryFileDragPayload {
  relativePath: string;
}

/** 不设 `text/plain`：否则落到 Tiptap/可编辑区时浏览器会先插入纯路径，再与我们的 `@路径` 叠成重复。 */
export function setWiseRepositoryFileDragData(dataTransfer: DataTransfer, relativePath: string): void {
  const trimmed = relativePath.trim();
  if (!trimmed) return;
  const payload: WiseRepositoryFileDragPayload = { relativePath: trimmed };
  dataTransfer.setData(WISE_REPOSITORY_FILE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
}

export function isWiseRepositoryFileDragDataTransfer(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return [...dt.types].includes(WISE_REPOSITORY_FILE_DRAG_MIME);
}

export function isWiseRepositoryFileDrag(event: DragEvent): boolean {
  return isWiseRepositoryFileDragDataTransfer(event.dataTransfer);
}

/** 从拖放事件解析仓库内相对路径（文件或目录）。 */
export function getWiseRepositoryFileDragPaths(event: DragEvent): string[] {
  const raw = event.dataTransfer.getData(WISE_REPOSITORY_FILE_DRAG_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WiseRepositoryFileDragPayload;
      const p = parsed.relativePath?.trim();
      if (p) return [p];
    } catch {
      /* ignore */
    }
  }
  return [];
}
