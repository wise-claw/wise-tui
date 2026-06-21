import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import {
  rowElementCacheHit,
  type CachedRowElement,
  type RowElementCacheContext,
} from "./ChatMessageListVirtualBody";

function msgRow(id: number): ChatMessageListRow {
  return {
    kind: "message",
    key: `${id}:0`,
    originalIndex: 0,
    msg: { id, role: "assistant", content: "hi", timestamp: "" },
    streamingThisBubble: false,
    mergedWithPrevious: false,
    toolUser: false,
  };
}

/** 与 claudeChatMessageListRows.ts 的 THINKING_HINT_ROW 等价的稳定引用（测试用本地副本）。 */
const THINKING_HINT_ROW: ChatMessageListRow = { kind: "thinking-hint", key: "thinking-hint" };

function baseCtx(overrides: Partial<RowElementCacheContext> = {}): RowElementCacheContext {
  return {
    sessionId: "s1",
    listVariant: "chat",
    resolveExecutionEnvironmentDispatchTask: undefined,
    onOpenTaskDetail: undefined,
    onOpenHistorySessionInInspector: undefined,
    onOpenSessionConversationTaskDetail: undefined,
    sessionsForDispatchLookup: undefined,
    renderRow: undefined,
    ...overrides,
  };
}

/** element 字段不参与命中判据，用占位对象即可。 */
function cachedEntry(row: ChatMessageListRow, index: number, ctx: RowElementCacheContext): CachedRowElement {
  return { element: {} as unknown as ReactElement, row, index, ...ctx };
}

describe("rowElementCacheHit", () => {
  test("hits when row ref, index and ctx all equal (token tick prefix)", () => {
    const row = msgRow(1);
    const ctx = baseCtx();
    const cached = cachedEntry(row, 0, ctx);
    expect(rowElementCacheHit(cached, row, 0, ctx)).toBe(true);
  });

  test("misses when row reference changes (streaming last row rebuild)", () => {
    const prev = msgRow(1);
    const next = msgRow(1); // 同 id 不同引用（末条重建）
    const ctx = baseCtx();
    const cached = cachedEntry(prev, 0, ctx);
    expect(rowElementCacheHit(cached, next, 0, ctx)).toBe(false);
  });

  test("misses when index changes (window shift / reclaim / expand)", () => {
    const row = msgRow(1);
    const ctx = baseCtx();
    const cached = cachedEntry(row, 0, ctx);
    expect(rowElementCacheHit(cached, row, 1, ctx)).toBe(false);
  });

  test("misses when onOpenTaskDetail reference changes (structure tick)", () => {
    const row = msgRow(1);
    const prevCtx = baseCtx({ onOpenTaskDetail: () => undefined });
    const nextCtx = baseCtx({ onOpenTaskDetail: () => undefined });
    const cached = cachedEntry(row, 0, prevCtx);
    expect(rowElementCacheHit(cached, row, 0, nextCtx)).toBe(false);
  });

  test("misses when sessionsForDispatchLookup reference changes (structure tick)", () => {
    const row = msgRow(1);
    const prevCtx = baseCtx({ sessionsForDispatchLookup: [] });
    const nextCtx = baseCtx({ sessionsForDispatchLookup: [] });
    const cached = cachedEntry(row, 0, prevCtx);
    expect(rowElementCacheHit(cached, row, 0, nextCtx)).toBe(false);
  });

  test("hits for thinking-hint row with stable reference (constant object)", () => {
    const ctx = baseCtx();
    const cached = cachedEntry(THINKING_HINT_ROW, 5, ctx);
    expect(rowElementCacheHit(cached, THINKING_HINT_ROW, 5, ctx)).toBe(true);
  });

  test("renderRow: same ref hits, different ref misses, both undefined hits", () => {
    const row = msgRow(1);
    const renderA = () => null;
    const renderB = () => null;
    // 皆 undefined → 命中
    expect(rowElementCacheHit(cachedEntry(row, 0, baseCtx()), row, 0, baseCtx())).toBe(true);
    // 同引用 → 命中
    expect(
      rowElementCacheHit(
        cachedEntry(row, 0, baseCtx({ renderRow: renderA })),
        row,
        0,
        baseCtx({ renderRow: renderA }),
      ),
    ).toBe(true);
    // 不同引用 → 未命中
    expect(
      rowElementCacheHit(
        cachedEntry(row, 0, baseCtx({ renderRow: renderA })),
        row,
        0,
        baseCtx({ renderRow: renderB }),
      ),
    ).toBe(false);
  });

  test("misses when sessionId or listVariant changes", () => {
    const row = msgRow(1);
    const ctx = baseCtx();
    expect(rowElementCacheHit(cachedEntry(row, 0, ctx), row, 0, baseCtx({ sessionId: "s2" }))).toBe(false);
    expect(
      rowElementCacheHit(cachedEntry(row, 0, ctx), row, 0, baseCtx({ listVariant: "monitor" })),
    ).toBe(false);
  });

  test("misses when other callback references change", () => {
    const row = msgRow(1);
    const ctx = baseCtx();
    expect(
      rowElementCacheHit(
        cachedEntry(row, 0, ctx),
        row,
        0,
        baseCtx({ onOpenHistorySessionInInspector: () => undefined }),
      ),
    ).toBe(false);
    expect(
      rowElementCacheHit(
        cachedEntry(row, 0, ctx),
        row,
        0,
        baseCtx({ onOpenSessionConversationTaskDetail: () => undefined }),
      ),
    ).toBe(false);
    expect(
      rowElementCacheHit(
        cachedEntry(row, 0, ctx),
        row,
        0,
        baseCtx({ resolveExecutionEnvironmentDispatchTask: () => null }),
      ),
    ).toBe(false);
  });
});
