import { beforeEach, expect, mock, test } from "bun:test";

const loadShowThinkingMessagesFromStore = mock(async () => true);

mock.module("../services/wiseDefaultConfigStore", () => ({
  loadShowThinkingMessagesFromStore,
  WISE_SHOW_THINKING_MESSAGES_CHANGED: "wise:show-thinking-messages-changed",
}));

import {
  ensureShowThinkingMessagesReady,
  getShowThinkingMessages,
  setShowThinkingMessages,
  subscribeShowThinkingMessages,
} from "./showThinkingMessagesStore";

function installWindowStub(): void {
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((handler) => handler(event));
        return true;
      },
      addEventListener: (type: string, handler: EventListener) => {
        const bucket = listeners.get(type) ?? new Set<EventListener>();
        bucket.add(handler);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      },
    },
    configurable: true,
  });
}

// 监听器在首次 ensure 时绑定到当前 window，因此整个文件复用同一个 stub。
installWindowStub();

beforeEach(() => {
  setShowThinkingMessages(false);
  loadShowThinkingMessagesFromStore.mockImplementation(async () => true);
});

test("默认不显示；set 只在变化时通知订阅者", () => {
  expect(getShowThinkingMessages()).toBe(false);
  const seen: boolean[] = [];
  const unsubscribe = subscribeShowThinkingMessages(() => seen.push(getShowThinkingMessages()));

  setShowThinkingMessages(true);
  setShowThinkingMessages(true);
  unsubscribe();
  setShowThinkingMessages(false);

  expect(seen).toEqual([true]);
  expect(getShowThinkingMessages()).toBe(false);
});

test("首次读取从默认配置灌入持久化值", async () => {
  loadShowThinkingMessagesFromStore.mockImplementation(async () => true);
  ensureShowThinkingMessagesReady();
  await Promise.resolve();
  await Promise.resolve();
  expect(getShowThinkingMessages()).toBe(true);
});

test("默认配置保存事件同步可见性", () => {
  ensureShowThinkingMessagesReady();
  window.dispatchEvent(
    new CustomEvent("wise:show-thinking-messages-changed", {
      detail: { showThinkingMessages: true },
    }),
  );
  expect(getShowThinkingMessages()).toBe(true);

  window.dispatchEvent(
    new CustomEvent("wise:show-thinking-messages-changed", {
      detail: { showThinkingMessages: false },
    }),
  );
  expect(getShowThinkingMessages()).toBe(false);
});
