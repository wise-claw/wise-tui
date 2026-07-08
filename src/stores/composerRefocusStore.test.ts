import { afterEach, describe, expect, test } from "bun:test";
import {
  requestComposerRefocus,
  consumeComposerRefocus,
  getComposerRefocusSnapshot,
  subscribeComposerRefocus,
  migrateComposerRefocus,
  resetComposerRefocusStoreForTests,
  setComposerRefocusNowForTests,
} from "./composerRefocusStore";

/**
 * 发送后重新聚焦请求队列的单元测试。
 *
 * 覆盖核心契约：
 * - consume 未请求返回 false；request 后在 TTL 内始终命中（只读不删，支持旧编辑器提前
 *   consume 后 migrate 仍能把请求迁到新 id）。
 * - 跨 session 隔离（多屏各 pane 互不干扰）。
 * - TTL 过期后 consume 返回 false、snapshot 归 0（陈旧请求不触发聚焦）。
 * - 空 sessionId 不写入。
 * - subscribe 在 request 后被通知；consume 只读不通知。
 * - 竞态回归：旧编辑器提前 consume 不阻止 migrate 把请求迁到新 id。
 *
 * 时间通过 setComposerRefocusNowForTests 注入，避免 setSystemTime 污染全局时钟
 * 影响其它依赖真实时间的测试（如 withMinLoadingDuration）。
 */

describe("composerRefocusStore", () => {
  afterEach(() => {
    resetComposerRefocusStoreForTests();
    setComposerRefocusNowForTests(null);
  });

  test("consume 未请求返回 false", () => {
    expect(consumeComposerRefocus("s1")).toBe(false);
  });

  test("request 后 consume 在 TTL 内始终命中（只读不删）", () => {
    requestComposerRefocus("s1");
    expect(consumeComposerRefocus("s1")).toBe(true);
    // consume 只读不删：旧编辑器提前 consume 不会清空请求，迁移后新编辑器仍能命中
    expect(consumeComposerRefocus("s1")).toBe(true);
    expect(consumeComposerRefocus("s1")).toBe(true);
  });

  test("跨 session 隔离", () => {
    requestComposerRefocus("s1");
    expect(consumeComposerRefocus("s2")).toBe(false);
    expect(consumeComposerRefocus("s1")).toBe(true);
  });

  test("consume 不删除请求，snapshot 不变", () => {
    expect(getComposerRefocusSnapshot("s1")).toBe(0);
    requestComposerRefocus("s1");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    consumeComposerRefocus("s1");
    // consume 只读：请求仍在，snapshot 不归零
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
  });

  test("TTL 过期后 consume 返回 false 且 snapshot 归 0", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    requestComposerRefocus("s1");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    // 推进 3s（TTL=2.5s）后应过期
    t += 3000;
    expect(consumeComposerRefocus("s1")).toBe(false);
    expect(getComposerRefocusSnapshot("s1")).toBe(0);
  });

  test("TTL 内 consume 返回 true", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    requestComposerRefocus("s1");
    t += 2000;
    expect(consumeComposerRefocus("s1")).toBe(true);
  });

  test("空 sessionId 不写入", () => {
    requestComposerRefocus("");
    expect(getComposerRefocusSnapshot("")).toBe(0);
    expect(consumeComposerRefocus("")).toBe(false);
  });

  test("subscribe 在 request 后被通知，consume 只读不通知", () => {
    let calls = 0;
    const unsub = subscribeComposerRefocus(() => {
      calls += 1;
    });
    requestComposerRefocus("s1");
    expect(calls).toBe(1);
    consumeComposerRefocus("s1");
    // consume 只读，不触发通知
    expect(calls).toBe(1);
    unsub();
    requestComposerRefocus("s1");
    expect(calls).toBe(1);
  });

  test("migrate 把请求从旧 id 迁到新 id", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    requestComposerRefocus("tab-1");
    migrateComposerRefocus("tab-1", "real-uuid-1");
    // 旧 id 已无请求
    expect(getComposerRefocusSnapshot("tab-1")).toBe(0);
    expect(consumeComposerRefocus("tab-1")).toBe(false);
    // 新 id 承接请求，TTL 内 consume 命中
    t += 500;
    expect(consumeComposerRefocus("real-uuid-1")).toBe(true);
  });

  test("migrate 源 id 无请求时为 no-op", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    migrateComposerRefocus("tab-empty", "real-uuid-2");
    expect(getComposerRefocusSnapshot("real-uuid-2")).toBe(0);
    expect(consumeComposerRefocus("real-uuid-2")).toBe(false);
  });

  test("migrate 目标已有请求则取更晚到期，避免缩短窗口", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    // toClaudeSessionId 上先有一个请求（t + TTL）
    requestComposerRefocus("real-uuid-3");
    // 推进时间后 fromTabId 再请求（到期更晚），migrate 应取更晚者
    t += 1000;
    requestComposerRefocus("tab-3");
    migrateComposerRefocus("tab-3", "real-uuid-3");
    expect(getComposerRefocusSnapshot("tab-3")).toBe(0);
    // 回退到 toClaudeSessionId 原请求已过期的时间点，仍应命中（取了更晚的 fromExpiry）
    t -= 500;
    expect(consumeComposerRefocus("real-uuid-3")).toBe(true);
  });

  test("migrate 相同 id 或空 id 时为 no-op", () => {
    requestComposerRefocus("s1");
    migrateComposerRefocus("s1", "s1");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    migrateComposerRefocus("", "s1");
    migrateComposerRefocus("s1", "");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    expect(consumeComposerRefocus("s1")).toBe(true);
  });

  test("旧编辑器提前 consume 不阻止 migrate 把请求迁到新 id（竞态回归）", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    // 普通会话首次发送：handleSend finally 在旧 tabId 上 request
    requestComposerRefocus("tab-1");
    // 旧 ComposerRegion（session.id=tab-1）的 refocus effect 在「发送后约 1 帧」先触发，
    // 远早于流返回 realSessionId 触发迁移；consume 只读不删，请求仍在
    expect(consumeComposerRefocus("tab-1")).toBe(true);
    expect(getComposerRefocusSnapshot("tab-1")).toBeGreaterThan(0);
    // 流返回 realSessionId，onSessionTabIdMigrated 把请求迁到 realSessionId
    migrateComposerRefocus("tab-1", "real-uuid-1");
    expect(getComposerRefocusSnapshot("tab-1")).toBe(0);
    // remount 后新 ComposerRegion 用 realSessionId consume 仍命中，聚焦成功
    t += 500;
    expect(consumeComposerRefocus("real-uuid-1")).toBe(true);
  });
});
