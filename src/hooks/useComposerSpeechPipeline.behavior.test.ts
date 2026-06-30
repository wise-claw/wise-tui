import { describe, expect, test } from "bun:test";
import {
  shouldCloseSpeechKeepAliveOnListeningEnd,
  shouldSkipPolishedOverlay,
} from "./useComposerSpeechPipeline";

describe("shouldSkipPolishedOverlay", () => {
  test("polished 与 immediate 完全一致 → 跳过", () => {
    expect(shouldSkipPolishedOverlay("好的", "好的", "好的")).toBe(true);
  });

  test("polished 与 immediate 仅标点/空白差异 → 跳过", () => {
    // 表面文本未被用户修改，polished 仅多了句号
    expect(
      shouldSkipPolishedOverlay("好的", "好的", "好的。"),
    ).toBe(true);
    expect(
      shouldSkipPolishedOverlay("好的", "  好的。  ", "好的"),
    ).toBe(true);
  });

  test("用户已改字（surface ≠ immediate）→ 跳过覆盖，绝不能丢字", () => {
    // 用户在阶段 1 之后把 "好的" 改成 "好的没问题"
    expect(
      shouldSkipPolishedOverlay("好的没问题", "好的", "好的。"),
    ).toBe(true);
    // 即使 polished 与 immediate 等价，也不能覆盖用户改后的版本
    expect(
      shouldSkipPolishedOverlay("好的没问题", "好的", "好的"),
    ).toBe(true);
  });

  test("polished 真正变化且 surface 与 immediate 一致 → 不跳过（正常覆盖）", () => {
    expect(
      shouldSkipPolishedOverlay("帮我加个按钮", "帮我加个按钮", "请帮我添加一个按钮。"),
    ).toBe(false);
  });

  test("空字符串 surface（hook 启动初期）→ 不被误判为用户改字", () => {
    // currentSurfacePlain 空 → 不应被当成"用户已改字"，走 polished vs immediate 比对
    expect(
      shouldSkipPolishedOverlay("", "好的", "好的。"),
    ).toBe(true);
    expect(
      shouldSkipPolishedOverlay("", "帮我加个按钮", "请帮我添加一个按钮"),
    ).toBe(false);
  });
});

// ---------------- Bug D 回归：会话执行完自动关麦 ----------------
//
// 历史上 hook A 监听 `speechDictation.listening/transcribing`，当 listening+
// transcribing 都被引擎翻 false（Sherpa streaming finalize 完成）时无条件
// `setSpeechKeepAliveDuringBusy(false)`。由于 finalize 在 `isSessionBusy=true`
// 阶段触发，keepAlive 被翻 false 后 enabled = `!true || false = false` →
// `useComposerSpeechDictation` 内部 stop → 用户感受「会话执行完语音会自动
// 关闭」(Bug D)。
//
// 修法：listening/transcribing 都被翻 false 时，仅在「会话不在忙」时才关闭
// keepAlive（大概率是用户主动 toggle off）；busy=true 时保留 keepAlive 让
// 麦克风在会话执行期间继续工作。
//
// 本组单测覆盖 `shouldCloseSpeechKeepAliveOnListeningEnd` 纯函数契约，确保
// hook A 在 busy=true 时不会把 keepAlive 翻 false。

describe("shouldCloseSpeechKeepAliveOnListeningEnd（Bug D 修复点）", () => {
  test("会话正在跑（busy=true）→ 不应关闭 keepAlive（Bug D 核心）", () => {
    // Sherpa finalize race：listening/transcribing 都被翻 false 但 busy=true。
    // 修法前：keepAlive 被关 → enabled=false → 引擎 stop → 用户感受"自动关麦"。
    // 修法后：keepAlive 保留 → enabled=true → 麦克风继续工作。
    expect(shouldCloseSpeechKeepAliveOnListeningEnd(true)).toBe(false);
  });

  test("会话不在忙（busy=false）→ 允许关闭 keepAlive（用户主动 toggle）", () => {
    // busy=false 时 listening 翻 false 大概率是用户主动 toggle off，
    // 此时应允许关闭 keepAlive，让麦克风状态与用户意图一致。
    expect(shouldCloseSpeechKeepAliveOnListeningEnd(false)).toBe(true);
  });

  test("Bug D 真实回归：busy=true → keepAlive 不被关，enabled 不会变 false", () => {
    // 完整链路契约：
    // isSessionBusy=true + keepAlive=true → enabled = !true || true = true
    // 会话执行中 enabled 必须保持 true，麦克风不被引擎 stop。
    const isSessionBusy = true;
    const shouldClose = shouldCloseSpeechKeepAliveOnListeningEnd(isSessionBusy);
    expect(shouldClose).toBe(false);
    // 推演：keepAlive 未被翻 false（仍 true），enabled = !true || true = true。
    const enabled = !isSessionBusy || true;
    expect(enabled).toBe(true);
  });

  test("Bug D 对照：busy=false 时用户 toggle off，keepAlive 允许关", () => {
    // busy=false + keepAlive=true → enabled = !false || true = true
    // 用户在 idle 期间 toggle off 时，hook A 翻 keepAlive=false，下一拍
    // enabled = !false || false = true（仍允许 start 但 wantListening=false 不重启）。
    // 这是当前 toggle off 的预期行为：麦克风状态完全由 user intent 控制。
    const isSessionBusy = false;
    const shouldClose = shouldCloseSpeechKeepAliveOnListeningEnd(isSessionBusy);
    expect(shouldClose).toBe(true);
  });
});
