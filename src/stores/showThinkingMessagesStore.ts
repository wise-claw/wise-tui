import { useSyncExternalStore } from "react";
import {
  loadShowThinkingMessagesFromStore,
  WISE_SHOW_THINKING_MESSAGES_CHANGED,
} from "../services/wiseDefaultConfigStore";

/**
 * 会话消息里「思考」卡片（reasoning 过程）的可见性。
 *
 * 每条消息行 / 气泡都要读它，且在「默认配置」面板保存后必须立刻生效，
 * 因此放 store（useSyncExternalStore）而不是逐层透传 props。
 * 默认 `false`：默认不显示思考过程，避免过程内容干扰结论阅读。
 */

let showThinkingMessages = false;
const listeners = new Set<() => void>();

export function getShowThinkingMessages(): boolean {
  return showThinkingMessages;
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function setShowThinkingMessages(next: boolean): void {
  if (showThinkingMessages === next) return;
  showThinkingMessages = next;
  emit();
}

export function subscribeShowThinkingMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let hydrated = false;
let watchDisposer: (() => void) | null = null;

/** 监听默认配置保存派发的事件：多窗口与面板保存后同步可见性。 */
function ensureWatchStarted(): void {
  if (watchDisposer || typeof window === "undefined") return;
  const onChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ showThinkingMessages?: boolean }>).detail;
    if (typeof detail?.showThinkingMessages === "boolean") {
      setShowThinkingMessages(detail.showThinkingMessages);
      return;
    }
    void loadShowThinkingMessagesFromStore().then(setShowThinkingMessages).catch(() => {
      /* 读失败保持当前值 */
    });
  };
  window.addEventListener(WISE_SHOW_THINKING_MESSAGES_CHANGED, onChanged as EventListener);
  watchDisposer = () => {
    window.removeEventListener(WISE_SHOW_THINKING_MESSAGES_CHANGED, onChanged as EventListener);
    watchDisposer = null;
  };
}

/** 幂等：从 `wise.defaultConfig` 灌入持久化值，并挂上变更监听。 */
export function ensureShowThinkingMessagesReady(): void {
  ensureWatchStarted();
  if (hydrated) return;
  hydrated = true;
  void loadShowThinkingMessagesFromStore()
    .then(setShowThinkingMessages)
    .catch(() => {
      /* 读失败按默认（不显示）处理 */
    });
}

/** 入口处调用：React 挂载前灌入持久化值，避免首帧按默认值渲染一次。 */
export function bootstrapShowThinkingMessages(): void {
  ensureShowThinkingMessagesReady();
}

export function useShowThinkingMessages(): boolean {
  ensureShowThinkingMessagesReady();
  return useSyncExternalStore(
    subscribeShowThinkingMessages,
    getShowThinkingMessages,
    getShowThinkingMessages,
  );
}
