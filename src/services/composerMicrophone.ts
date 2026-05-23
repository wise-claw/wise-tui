import { invoke, isTauri } from "@tauri-apps/api/core";
import { macosOpenPrivacyPane } from "./cuaDriver";

export type ComposerMicrophoneAccessResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "error"; message: string };

/** 停止 getUserMedia 返回的麦克风流，避免占用设备。 */
export function stopMediaStreamTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 会话语音听写前确保麦克风可用：
 * 1. macOS 桌面端先走 AVFoundation 系统授权（会弹出「Wise 想访问麦克风」）
 * 2. 再在 WebView 内请求 getUserMedia，满足 WKWebView / SpeechRecognition 要求
 */
export async function ensureComposerMicrophoneAccess(): Promise<ComposerMicrophoneAccessResult> {
  if (isTauri()) {
    try {
      const nativeGranted = await invoke<boolean>("macos_request_microphone_access");
      if (!nativeGranted) {
        return {
          ok: false,
          reason: "denied",
          message: "未获得麦克风权限。请在系统设置中为 Wise 开启麦克风后重试。",
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: "error", message: msg || "请求麦克风权限失败" };
    }
  }

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    return { ok: false, reason: "unsupported", message: "当前环境不支持麦克风访问。" };
  }

  let stream: MediaStream | null = null;
  try {
    stream = await mediaDevices.getUserMedia({ audio: true });
    return { ok: true };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        reason: "denied",
        message: "未获得麦克风权限。请在系统设置中允许本应用访问麦克风。",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, reason: "error", message: "未检测到可用麦克风。" };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "error", message: msg || "无法访问麦克风" };
  } finally {
    stopMediaStreamTracks(stream);
  }
}

/** 麦克风被拒绝时打开系统「隐私与安全性 → 麦克风」面板（仅 macOS 桌面端）。 */
export async function openComposerMicrophonePrivacySettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    await macosOpenPrivacyPane("microphone");
  } catch {
    /* 打开失败时静默；主流程已提示用户手动前往系统设置 */
  }
}
