import { describe, expect, it } from "vitest";
import { shouldHandleComposerGlobalShortcut } from "./composerShortcutSurface";

describe("shouldHandleComposerGlobalShortcut", () => {
  it("可见的 HUD 窗始终处理（含 store 尚未同步）", () => {
    expect(shouldHandleComposerGlobalShortcut("hud", true)).toBe(true);
    expect(shouldHandleComposerGlobalShortcut("hud", false)).toBe(true);
  });

  it("隐藏的 HUD 窗不处理", () => {
    expect(shouldHandleComposerGlobalShortcut("hud", true, true)).toBe(false);
    expect(shouldHandleComposerGlobalShortcut("hud", false, true)).toBe(false);
  });

  it("HUD 模式中主窗忽略", () => {
    expect(shouldHandleComposerGlobalShortcut("main", true)).toBe(false);
  });

  it("主窗模式只让主会话输入面响应", () => {
    expect(shouldHandleComposerGlobalShortcut("main", false)).toBe(true);
  });
});
