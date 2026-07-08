import { afterEach, describe, expect, test } from "bun:test";
import {
  requestComposerRefocus,
  consumeComposerRefocus,
  getComposerRefocusSnapshot,
  subscribeComposerRefocus,
  resetComposerRefocusStoreForTests,
  setComposerRefocusNowForTests,
} from "./composerRefocusStore";

/**
 * 发送后重新聚焦请求队列的单元测试。
 *
 * 覆盖核心契约：
 * - consume 未请求返回 false；request 后返回 true 且只生效一次。
 * - 跨 session 隔离（多屏各 pane 互不干扰）。
 * - TTL 过期后 consume 返回 false（陈旧请求不触发聚焦）。
 * - 空 sessionId 不写入。
 * - subscribe 在 request/consume 后被通知；取消订阅后不再通知。
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

  test("request 后 consume 返回 true 且只生效一次", () => {
    requestComposerRefocus("s1");
    expect(consumeComposerRefocus("s1")).toBe(true);
    expect(consumeComposerRefocus("s1")).toBe(false);
  });

  test("跨 session 隔离", () => {
    requestComposerRefocus("s1");
    expect(consumeComposerRefocus("s2")).toBe(false);
    expect(consumeComposerRefocus("s1")).toBe(true);
  });

  test("getComposerRefocusSnapshot 反映请求态", () => {
    expect(getComposerRefocusSnapshot("s1")).toBe(0);
    requestComposerRefocus("s1");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    consumeComposerRefocus("s1");
    expect(getComposerRefocusSnapshot("s1")).toBe(0);
  });

  test("TTL 过期后 consume 返回 false", () => {
    let t = 1_000_000;
    setComposerRefocusNowForTests(() => t);
    requestComposerRefocus("s1");
    expect(getComposerRefocusSnapshot("s1")).toBeGreaterThan(0);
    // 推进 3s（TTL=2.5s）后应过期
    t += 3000;
    expect(consumeComposerRefocus("s1")).toBe(false);
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

  test("subscribe 在 request/consume 后被通知，取消订阅后不再通知", () => {
    let calls = 0;
    const unsub = subscribeComposerRefocus(() => {
      calls += 1;
    });
    requestComposerRefocus("s1");
    expect(calls).toBe(1);
    consumeComposerRefocus("s1");
    expect(calls).toBe(2);
    unsub();
    requestComposerRefocus("s1");
    expect(calls).toBe(2);
  });
});
