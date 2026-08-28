import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/event", () => ({
  listen: mock(async () => () => {}),
}));

import {
  focusComposerEditorForSession,
  noteComposerScreenshotFocus,
  registerGlobalFocusComposerRecipient,
  restoreComposerFocusAfterHudExit,
} from "./globalScreenshotHotkey";

describe("restoreComposerFocusAfterHudExit", () => {
  const unsubs: Array<() => void> = [];

  afterEach(() => {
    for (const unsub of unsubs.splice(0)) unsub();
  });

  test("优先聚焦 HUD 对应的当前会话，而不是主窗里更早触摸的另一栏", () => {
    const first = mock(() => {});
    const active = mock(() => {});
    unsubs.push(registerGlobalFocusComposerRecipient("s1", first));
    unsubs.push(registerGlobalFocusComposerRecipient("s2", active));
    noteComposerScreenshotFocus("s1");

    expect(focusComposerEditorForSession("s2")).toBe(true);
    expect(active).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test("未注册的会话回退到最近触摸的输入面", () => {
    const touched = mock(() => {});
    unsubs.push(registerGlobalFocusComposerRecipient("s1", touched));
    noteComposerScreenshotFocus("s1");

    expect(focusComposerEditorForSession("missing")).toBe(true);
    expect(touched).toHaveBeenCalledTimes(1);
  });

  test("没有已注册输入面时返回 false", () => {
    expect(focusComposerEditorForSession("s1")).toBe(false);
  });

  test("HUD 退出后立刻聚焦，并在短延迟后再试一次", () => {
    const focus = mock(() => {});
    unsubs.push(registerGlobalFocusComposerRecipient("s1", focus));

    const timers: Array<{ fn: () => void; ms: number }> = [];
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number) => {
      if (typeof fn === "function") timers.push({ fn: fn as () => void, ms: ms ?? 0 });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      restoreComposerFocusAfterHudExit("s1");
      expect(focus).toHaveBeenCalledTimes(1);
      expect(timers).toHaveLength(1);
      expect(timers[0]?.ms).toBe(80);
      timers[0]?.fn();
      expect(focus).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
