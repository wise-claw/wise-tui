import { describe, expect, test } from "bun:test";
import type { PaneSlot } from "../constants/mainLayoutWidths";
import {
  assignSessionToNormalizedExtraPanes,
  findFirstEmptyExtraPaneIndex,
  isSessionBoundInPanes,
  listEmptyExtraPaneIndices,
  minPaneCountForOccupiedExtras,
  normalizeExtraPanesToPaneCount,
  planNextPaneSlotPlacement,
  rebindPaneSlotPreservingRuntime,
  resolveFocusedPaneTargetSlot,
} from "./multiPaneSlots";

function slot(partial: Partial<PaneSlot> & { slotId: string }): PaneSlot {
  return {
    sessionId: null,
    repositoryId: null,
    ...partial,
  };
}

describe("multiPaneSlots", () => {
  test("minPaneCountForOccupiedExtras follows 1/2/4/6/8 grid tiers", () => {
    expect(minPaneCountForOccupiedExtras(0)).toBe(1);
    expect(minPaneCountForOccupiedExtras(1)).toBe(2);
    expect(minPaneCountForOccupiedExtras(2)).toBe(4);
    expect(minPaneCountForOccupiedExtras(3)).toBe(4);
    expect(minPaneCountForOccupiedExtras(5)).toBe(6);
    expect(minPaneCountForOccupiedExtras(7)).toBe(8);
  });

  test("third pane in 4-grid targets bottom-left extra slot (index 1)", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1", repositoryId: 1 }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    expect(findFirstEmptyExtraPaneIndex(extraPanes)).toBe(1);
    const plan = planNextPaneSlotPlacement({
      paneCount: 4,
      extraPanes,
      createSlot: () => slot({ slotId: "new" }),
    });
    expect(plan.nextPaneCount).toBe(4);
    expect(plan.slotIndex).toBe(1);
  });

  test("normalizeExtraPanesToPaneCount pads and truncates slots", () => {
    const slots: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1" }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    const padded = normalizeExtraPanesToPaneCount(4, slots.slice(0, 1), () => slot({ slotId: "new" }));
    expect(padded).toHaveLength(3);
    expect(padded[0]?.sessionId).toBe("s1");
    expect(padded[1]?.slotId).toBe("new");

    const truncated = normalizeExtraPanesToPaneCount(2, slots, () => slot({ slotId: "x" }));
    expect(truncated).toHaveLength(1);
    expect(truncated[0]?.sessionId).toBe("s1");
  });

  test("listEmptyExtraPaneIndices returns empty companion slots only", () => {
    const extras: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1" }),
      slot({ slotId: "b" }),
      slot({ slotId: "c", sessionId: "  " }),
      slot({ slotId: "d", sessionId: "s2" }),
    ];
    expect(listEmptyExtraPaneIndices(extras)).toEqual([1, 2]);
    expect(listEmptyExtraPaneIndices([])).toEqual([]);
  });

  test("isSessionBoundInPanes detects active and extra pane collisions", () => {
    const extras: PaneSlot[] = [slot({ slotId: "a", sessionId: "s-extra" })];
    expect(isSessionBoundInPanes("s-main", "s-main", extras)).toBe(true);
    expect(isSessionBoundInPanes("s-extra", "s-main", extras)).toBe(true);
    expect(isSessionBoundInPanes("s-extra", "s-main", extras, 0)).toBe(false);
    expect(isSessionBoundInPanes("s-free", "s-main", extras)).toBe(false);
  });

  test("assignSessionToNormalizedExtraPanes prefers first empty slot in row-major grid", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1", repositoryId: 1 }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    const next = assignSessionToNormalizedExtraPanes(4, extraPanes, "s-new", () => slot({ slotId: "x" }), 2);
    expect(next).toHaveLength(3);
    expect(next[1]?.sessionId).toBe("s-new");
    expect(next[1]?.executionEngine).toBeUndefined();
    expect(next[2]?.sessionId).toBeNull();
  });

  test("assignSessionToNormalizedExtraPanes clears stale slot runtime when primary unset", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", executionEngine: "codex", claudeProxyRoute: undefined }),
    ];
    const next = assignSessionToNormalizedExtraPanes(
      2,
      extraPanes,
      "s-new",
      () => slot({ slotId: "x" }),
      0,
      null,
    );
    expect(next[0]?.executionEngine).toBeUndefined();
    expect(next[0]?.claudeProxyRoute).toBeUndefined();
  });

  test("assignSessionToNormalizedExtraPanes inherits primary pane runtime", () => {
    const extraPanes: PaneSlot[] = [slot({ slotId: "a" }), slot({ slotId: "b" })];
    const next = assignSessionToNormalizedExtraPanes(
      2,
      extraPanes,
      "s-new",
      () => slot({ slotId: "x" }),
      0,
      { executionEngine: "codex" },
    );
    expect(next[0]?.executionEngine).toBe("codex");
  });

  test("assignSessionToNormalizedExtraPanes pads slots when paneCount increases", () => {
    const next = assignSessionToNormalizedExtraPanes(
      4,
      [slot({ slotId: "a", sessionId: "s1" })],
      "s2",
      () => slot({ slotId: "new" }),
      0,
    );
    expect(next).toHaveLength(3);
    expect(next.filter((row) => row.sessionId === "s2")).toHaveLength(1);
  });

  test("rebindPaneSlotPreservingRuntime preserves slot runtime and replaces session/repo", () => {
    const pane: PaneSlot = {
      slotId: "a",
      sessionId: "old-session",
      repositoryId: 1,
      executionEngine: "codex",
      claudeProxyRoute: "bypass",
    };
    const next = rebindPaneSlotPreservingRuntime(pane, "new-session", 2);
    expect(next.slotId).toBe("a");
    expect(next.sessionId).toBe("new-session");
    expect(next.repositoryId).toBe(2);
    expect(next.executionEngine).toBe("codex");
    expect(next.claudeProxyRoute).toBe("bypass");
  });

  test("rebindPaneSlotPreservingRuntime drops runtime when slot has none", () => {
    const pane: PaneSlot = { slotId: "a", sessionId: "old", repositoryId: 1 };
    const next = rebindPaneSlotPreservingRuntime(pane, "new", null);
    expect(next.sessionId).toBe("new");
    expect(next.repositoryId).toBeNull();
    expect(next.executionEngine).toBeUndefined();
    expect(next.claudeProxyRoute).toBeUndefined();
  });

  test("rebindPaneSlotPreservingRuntime does not inherit primary pane runtime", () => {
    const pane: PaneSlot = {
      slotId: "a",
      sessionId: "old",
      repositoryId: null,
      executionEngine: "claude",
      claudeProxyRoute: "auto",
    };
    const next = rebindPaneSlotPreservingRuntime(pane, "new", null);
    expect(next.executionEngine).toBe("claude");
    expect(next.claudeProxyRoute).toBe("auto");
  });
});

describe("resolveFocusedPaneTargetSlot", () => {
  // 多屏下侧栏/顶栏选仓库/工作区 → 路由到当前聚焦 pane，避免污染全局 activeRepositoryId。
  // 单屏维持"写全局"语义；多屏 Pane 0（无 per-pane 槽）暂回退到全局；extra pane 命中 slot。
  const extras: PaneSlot[] = [
    slot({ slotId: "pane-extra-1", sessionId: "s1", repositoryId: 100 }),
    slot({ slotId: "pane-extra-2", sessionId: null, repositoryId: null }),
  ];

  test("单屏返回 none，调用方写全局", () => {
    expect(resolveFocusedPaneTargetSlot(1, 0, extras)).toEqual({ kind: "none" });
    expect(resolveFocusedPaneTargetSlot(1, 2, extras)).toEqual({ kind: "none" });
    expect(resolveFocusedPaneTargetSlot(1, null, extras)).toEqual({ kind: "none" });
  });

  test("多屏但未聚焦 → primary 兜底（写全局，不污染 extra slot）", () => {
    expect(resolveFocusedPaneTargetSlot(2, null, extras)).toEqual({ kind: "primary" });
    expect(resolveFocusedPaneTargetSlot(4, undefined, extras)).toEqual({ kind: "primary" });
  });

  test("多屏聚焦 Pane 0 → primary 兜底（当前 Pane 0 仍走全局）", () => {
    expect(resolveFocusedPaneTargetSlot(2, 0, extras)).toEqual({ kind: "primary" });
    expect(resolveFocusedPaneTargetSlot(8, 0, extras)).toEqual({ kind: "primary" });
  });

  test("多屏聚焦 extra pane 1 → 命中 extras[0]", () => {
    expect(resolveFocusedPaneTargetSlot(2, 1, extras)).toEqual({
      kind: "extra",
      slotIndex: 0,
      slot: extras[0],
    });
  });

  test("多屏聚焦 extra pane 2 → 命中 extras[1]", () => {
    expect(resolveFocusedPaneTargetSlot(2, 2, extras)).toEqual({
      kind: "extra",
      slotIndex: 1,
      slot: extras[1],
    });
  });

  test("多屏聚焦 pane 索引越界（> extraPanes.length）→ primary 兜底", () => {
    // paneCount 已升到 8 但 extraPanes 还没跟上（hydrate 瞬态或异常）。
    expect(resolveFocusedPaneTargetSlot(8, 5, extras)).toEqual({ kind: "primary" });
  });

  test("多屏聚焦但 extras 槽位为空数组 → primary 兜底", () => {
    expect(resolveFocusedPaneTargetSlot(2, 1, [])).toEqual({ kind: "primary" });
  });
});
