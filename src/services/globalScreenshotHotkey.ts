import { listen } from "@tauri-apps/api/event";
import type { ImageAttachmentPart } from "../types";
import { captureScreenshot, screenshotResultToImagePart } from "./screenshot";

type Recipient = (part: ImageAttachmentPart) => void;

const recipients = new Map<string, Recipient>();
const focusRecipients = new Map<string, () => void>();

/** 最近一次在输入区内有过焦点或点击的会话（用于 F3 截屏 / ⌥Z 聚焦到正确栏） */
let lastTouchedSessionId: string | null = null;

let globalScreenshotListenStarted = false;
let globalFocusComposerListenStarted = false;

function resolveTargetSessionId(): string | null {
  if (lastTouchedSessionId && recipients.has(lastTouchedSessionId)) {
    return lastTouchedSessionId;
  }
  const first = recipients.keys().next().value;
  return first ?? null;
}

function resolveFocusTargetSessionId(): string | null {
  if (lastTouchedSessionId && focusRecipients.has(lastTouchedSessionId)) {
    return lastTouchedSessionId;
  }
  const first = focusRecipients.keys().next().value;
  return first ?? null;
}

function ensureGlobalScreenshotListener(): void {
  if (globalScreenshotListenStarted) return;
  globalScreenshotListenStarted = true;
  void listen("global-screenshot", async () => {
    console.log("[screenshot] global-screenshot (singleton listener)");
    const result = await captureScreenshot();
    if (!result) return;
    const part = screenshotResultToImagePart(result);
    const sid = resolveTargetSessionId();
    if (!sid) {
      console.warn("[screenshot] no recipient registered, drop image");
      return;
    }
    const cb = recipients.get(sid);
    if (!cb) {
      console.warn("[screenshot] recipient missing for session", sid);
      return;
    }
    cb(part);
  }).catch((err) => {
    console.error("[screenshot] global listen failed:", err);
    globalScreenshotListenStarted = false;
  });
}

/** 用户在某个会话输入区点击或 Tab 进入时调用，用于 F3 截屏与 ⌥Z 聚焦投递目标 */
export function noteComposerScreenshotFocus(sessionId: string): void {
  if (recipients.has(sessionId) || focusRecipients.has(sessionId)) {
    lastTouchedSessionId = sessionId;
  }
}

function ensureGlobalFocusComposerListener(): void {
  if (globalFocusComposerListenStarted) return;
  globalFocusComposerListenStarted = true;
  void listen("global-focus-composer", () => {
    const sid = resolveFocusTargetSessionId();
    if (!sid) {
      console.warn("[focus-composer] no recipient registered");
      return;
    }
    const fn = focusRecipients.get(sid);
    if (!fn) {
      console.warn("[focus-composer] recipient missing for session", sid);
      return;
    }
    fn();
  }).catch((err) => {
    console.error("[focus-composer] global listen failed:", err);
    globalFocusComposerListenStarted = false;
  });
}

/** 注册 ⌥Z（Option+Z）全局快捷键触发后的输入框聚焦回调；双栏时按最近触摸的会话 */
export function registerGlobalFocusComposerRecipient(sessionId: string, focusEditor: () => void): () => void {
  ensureGlobalFocusComposerListener();
  focusRecipients.set(sessionId, focusEditor);
  if (focusRecipients.size === 1) {
    lastTouchedSessionId = sessionId;
  }
  return () => {
    focusRecipients.delete(sessionId);
    if (lastTouchedSessionId === sessionId) {
      lastTouchedSessionId = focusRecipients.keys().next().value ?? null;
    }
  };
}

/**
 * 注册本会话接收 F3 截屏结果；双栏时全应用只跑一次 screencapture，再按最近触摸的会话投递。
 */
export function registerGlobalScreenshotRecipient(sessionId: string, onImage: Recipient): () => void {
  ensureGlobalScreenshotListener();
  recipients.set(sessionId, onImage);
  if (recipients.size === 1) {
    lastTouchedSessionId = sessionId;
  }
  return () => {
    recipients.delete(sessionId);
    if (lastTouchedSessionId === sessionId) {
      lastTouchedSessionId = recipients.keys().next().value ?? null;
    }
  };
}
