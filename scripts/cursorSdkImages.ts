import { pathToFileURL } from "node:url";

export type CursorSdkImageRef = { url: string } | { data: string; mimeType: string };

type CursorBridgeImage = {
  path?: string;
  mimeType?: string;
};

/** 将本地绝对路径映射为 SDK 可消费的 file URL，避免 bridge 进程整图 base64 驻留。 */
export function localImagePathToSdkUrl(absPath: string): string {
  return pathToFileURL(absPath).href;
}

/** 从前端传入的 `{ path, mimeType }` 列表构造 SDK 图片引用（仅路径，不读文件）。 */
export function bridgeImagesToSdkRefs(raw: unknown): CursorSdkImageRef[] {
  if (!Array.isArray(raw)) return [];
  const out: CursorSdkImageRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const path =
      typeof (item as CursorBridgeImage).path === "string"
        ? (item as CursorBridgeImage).path!.trim()
        : "";
    if (!path) continue;
    out.push({ url: localImagePathToSdkUrl(path) });
  }
  return out;
}
