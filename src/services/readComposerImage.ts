import { invoke } from "@tauri-apps/api/core";
import type { ImageAttachmentPart } from "../types";

/** 读取已落盘的 Composer 图片为 data URL（仅 `~/.wise/composer-images/` 内路径）。 */
export async function readComposerImageAsDataUrl(absPath: string): Promise<string | null> {
  const trimmed = absPath.trim();
  if (!trimmed) return null;
  try {
    return await invoke<string>("read_composer_image", { absPath: trimmed });
  } catch {
    return null;
  }
}

function trimComposerAttachmentPath(raw: string): string {
  return raw.trim().replace(/[。．.，,；;！!？?）)\]」』"'`]+$/u, "");
}

/** 从发送消息 / 用户气泡正文中解析 `附图：@/path/to/file` 里的绝对路径。 */
export function extractComposerAttachmentPathsFromText(text: string): string[] {
  const paths: string[] = [];
  const re = /附图[：:][^\n]*?@(\/[^\s\n]+)/gu;
  for (const match of text.matchAll(re)) {
    const p = trimComposerAttachmentPath(match[1] ?? "");
    if (p && !paths.includes(p)) paths.push(p);
  }
  return paths;
}

function basenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "image.png";
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
  };
  return map[ext] ?? "image/png";
}

/** 将落盘路径合并进待发/历史附图（与 saveComposerImage 结果对齐）。 */
export function attachDiskPathsToComposerImages(
  images: ImageAttachmentPart[],
  diskPaths: Array<string | null>,
): ImageAttachmentPart[] {
  return images.map((img, i) => {
    const diskPath = diskPaths[i]?.trim();
    return diskPath ? { ...img, diskPath } : { ...img };
  });
}

/** 恢复输入框缩略图：优先已有 dataUrl，否则从 diskPath 或正文里的 @ 路径读盘。 */
export async function hydrateComposerImagesForRestore(
  images: ImageAttachmentPart[],
  fallbackPathsFromText?: string[],
): Promise<ImageAttachmentPart[]> {
  const pathPool = [
    ...images.map((img) => img.diskPath?.trim() ?? "").filter(Boolean),
    ...(fallbackPathsFromText ?? []),
  ];
  let pathIdx = 0;
  const out: ImageAttachmentPart[] = [];

  for (const img of images) {
    const next = { ...img };
    if (next.dataUrl.startsWith("data:")) {
      out.push(next);
      continue;
    }
    let diskPath = next.diskPath?.trim();
    if (!diskPath && pathIdx < pathPool.length) {
      diskPath = pathPool[pathIdx++]!;
    }
    if (diskPath) {
      next.diskPath = diskPath;
      const dataUrl = await readComposerImageAsDataUrl(diskPath);
      if (dataUrl) {
        next.dataUrl = dataUrl;
        next.filename = next.filename || basenameFromPath(diskPath);
        next.mime = next.mime || mimeFromPath(diskPath);
      }
    }
    out.push(next);
  }

  if (out.length === 0 && pathPool.length > 0) {
    for (const diskPath of pathPool) {
      const dataUrl = await readComposerImageAsDataUrl(diskPath);
      if (!dataUrl) continue;
      out.push({
        type: "image",
        id: `img_restore_${out.length}_${Date.now()}`,
        filename: basenameFromPath(diskPath),
        mime: mimeFromPath(diskPath),
        dataUrl,
        diskPath,
      });
    }
  }

  return out;
}
