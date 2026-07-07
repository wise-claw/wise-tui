import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getAssistantsSnapshot,
  resetAssistantsStoreForTests,
  setAssistantsCache,
  subscribeAssistants,
} from "./assistantsStore";
import type { AssistantEntry } from "../types/assistant";

function makeAssistant(id: string, name: string): AssistantEntry {
  return {
    id,
    source: "custom",
    name,
    description: "",
    avatarColor: null,
    engineId: "claude",
    model: null,
    systemPrompt: "x",
    entryKind: "dispatch_direct",
    createdAt: "",
    updatedAt: "",
  };
}

beforeEach(() => {
  resetAssistantsStoreForTests();
});

afterEach(() => {
  resetAssistantsStoreForTests();
});

describe("assistantsStore", () => {
  test("首次订阅立即推送当前缓存（初始为空）", () => {
    const received: AssistantEntry[][] = [];
    const unsub = subscribeAssistants((rows) => {
      received.push(rows);
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
    expect(getAssistantsSnapshot()).toEqual([]);
    unsub();
  });

  test("setAssistantsCache 写入快照并广播给所有订阅方", () => {
    const a: AssistantEntry[] = [];
    const b: AssistantEntry[] = [];
    const unsubA = subscribeAssistants((rows) => {
      a.length = 0;
      for (const r of rows) a.push(r);
    });
    const unsubB = subscribeAssistants((rows) => {
      b.length = 0;
      for (const r of rows) b.push(r);
    });

    const next = [makeAssistant("custom:a", "A"), makeAssistant("custom:b", "B")];
    setAssistantsCache(next);

    expect(getAssistantsSnapshot().map((r) => r.id)).toEqual(["custom:a", "custom:b"]);
    expect(a.map((r) => r.id)).toEqual(["custom:a", "custom:b"]);
    expect(b.map((r) => r.id)).toEqual(["custom:a", "custom:b"]);

    unsubA();
    unsubB();
  });

  test("保存后二次写入只广播增量集合（订阅方缓存被新数组覆盖）", () => {
    const seen: string[] = [];
    const unsub = subscribeAssistants((rows) => {
      seen.length = 0;
      for (const r of rows) seen.push(r.id);
    });

    setAssistantsCache([makeAssistant("custom:a", "A")]);
    expect(seen).toEqual(["custom:a"]);

    // 保存后用新行覆盖缓存，旧订阅方收到的也是最新行（不是合并）
    setAssistantsCache([
      makeAssistant("custom:a", "A"),
      makeAssistant("custom:b", "B"),
      makeAssistant("custom:c", "C"),
    ]);
    expect(seen).toEqual(["custom:a", "custom:b", "custom:c"]);
    unsub();
  });

  test("取消订阅后不再收到后续广播", () => {
    const received: string[][] = [];
    const unsub = subscribeAssistants((rows) => {
      received.push(rows.map((r) => r.id));
    });
    setAssistantsCache([makeAssistant("custom:a", "A")]);
    unsub();
    setAssistantsCache([makeAssistant("custom:b", "B")]);
    // 第一行是初次推送（空），第二行是订阅期间推送；取消后的写入不再触发回调
    expect(received).toEqual([[], ["custom:a"]]);
  });

  test("订阅方抛错不影响其他订阅方", () => {
    const seen: string[] = [];
    const unsubBad = subscribeAssistants(() => {
      throw new Error("boom");
    });
    const unsubGood = subscribeAssistants((rows) => {
      seen.length = 0;
      for (const r of rows) seen.push(r.id);
    });
    // store 在 publish 时对每个订阅方 try/catch 隔离；写入不应抛出
    setAssistantsCache([makeAssistant("custom:a", "A")]);
    expect(seen).toEqual(["custom:a"]);
    unsubBad();
    unsubGood();
  });

  test("resetAssistantsStoreForTests 清空缓存与订阅", () => {
    const received: AssistantEntry[][] = [];
    subscribeAssistants((rows) => {
      received.push(rows);
    });
    setAssistantsCache([makeAssistant("custom:a", "A")]);
    expect(getAssistantsSnapshot()).toHaveLength(1);

    resetAssistantsStoreForTests();

    // 重置后首个订阅应当看到空缓存
    const after: AssistantEntry[] = [];
    const unsub = subscribeAssistants((rows) => {
      after.length = 0;
      for (const r of rows) after.push(r);
    });
    expect(after).toEqual([]);
    expect(getAssistantsSnapshot()).toEqual([]);
    unsub();
  });
});
