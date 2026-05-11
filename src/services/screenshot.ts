import { invoke } from "@tauri-apps/api/core";
import type { ImageAttachmentPart } from "../types";

export interface ScreenshotResult {
  filename: string;
  mime: string;
  base64_data: string;
}

function pickBase64Payload(raw: Record<string, unknown>): string | null {
  const a = raw.base64_data;
  const b = raw.base64Data;
  if (typeof a === "string" && a.length > 0) return a;
  if (typeof b === "string" && b.length > 0) return b;
  return null;
}

/** 将 Rust 返回的截屏数据转为会话附件结构 */
export function screenshotResultToImagePart(result: ScreenshotResult): ImageAttachmentPart {
  const mime = result.mime?.trim() || "image/png";
  const b64 = result.base64_data.replace(/\s/g, "");
  const dataUrl = `data:${mime};base64,${b64}`;
  return {
    type: "image",
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename: result.filename,
    mime,
    dataUrl,
  };
}

let captureInFlight = false;

/** 调用 macOS screencapture -i 进行交互式截屏，返回 base64 图片数据 */
export async function captureScreenshot(): Promise<ScreenshotResult | null> {
  if (captureInFlight) {
    console.warn("[screenshot] capture already in flight, skip duplicate invoke");
    return null;
  }
  captureInFlight = true;
  try {
    console.log("[screenshot] invoking capture_screenshot...");
    const raw = await invoke<Record<string, unknown>>("capture_screenshot");
    const base64_data = pickBase64Payload(raw);
    if (!base64_data) {
      console.error("[screenshot] missing base64 in invoke result keys:", Object.keys(raw));
      return null;
    }
    const filename = typeof raw.filename === "string" && raw.filename ? raw.filename : "screenshot.png";
    const mime = typeof raw.mime === "string" && raw.mime ? raw.mime : "image/png";
    console.log("[screenshot] result:", filename, mime, base64_data.length, "chars base64");
    return { filename, mime, base64_data };
  } catch (err) {
    console.error("[screenshot] invoke failed:", err);
    return null;
  } finally {
    captureInFlight = false;
  }
}
