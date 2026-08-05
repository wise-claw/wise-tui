import { isChromeScrollReliefActive } from "./chromePanelHoverStore";
import { isComposerTypingActive } from "./composerInteractionGate";
import { pollInteractionReliefRef } from "../utils/adaptivePoll";

/**
 * 把侧栏滚动 / 输入硬推迟接到自适应轮询，避免 IPC 与主线程重活在交互高峰抢帧。
 * 在 App 启动路径 import 一次即可（幂等）。
 */
export function wireAdaptivePollInteractionRelief(): void {
  pollInteractionReliefRef.current = () =>
    isChromeScrollReliefActive() || isComposerTypingActive();
}

wireAdaptivePollInteractionRelief();
