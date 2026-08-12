import { invoke } from "@tauri-apps/api/core";

interface FetchedImageData {
  mime: string;
  base64: string;
}

/** 后端下载远端图片（绕过 WebView CORS）为 data URL；失败返回 null。 */
export async function fetchRemoteImageAsDataUrl(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url.trim())) return null;
  try {
    const res = await invoke<FetchedImageData>("wise_fetch_remote_image", { url: url.trim() });
    if (!res?.base64 || !res?.mime?.startsWith("image/")) return null;
    return `data:${res.mime};base64,${res.base64}`;
  } catch {
    return null;
  }
}

/** 后端读本地图片文件为 data URL；失败返回 null。 */
export async function readLocalImageAsDataUrl(absPath: string): Promise<string | null> {
  if (!absPath.trim().startsWith("/")) return null;
  try {
    const res = await invoke<FetchedImageData>("wise_read_local_image", { absPath: absPath.trim() });
    if (!res?.base64 || !res?.mime?.startsWith("image/")) return null;
    return `data:${res.mime};base64,${res.base64}`;
  } catch {
    return null;
  }
}

/**
 * 后端直接从系统剪贴板读取图片（macOS WKWebView 的 DOM paste 拿不到图片数据时兜底）。
 * 剪贴板里没有图片时返回 null。
 */
export async function readSystemClipboardImage(): Promise<string | null> {
  try {
    const res = await invoke<FetchedImageData>("wise_read_clipboard_image");
    if (!res?.base64 || !res?.mime?.startsWith("image/")) return null;
    return `data:${res.mime};base64,${res.base64}`;
  } catch {
    return null;
  }
}
