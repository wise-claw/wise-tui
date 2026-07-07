import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  moveLayoutItem,
  partitionSessionQuickActions,
  updateLayoutItem,
} from "./sessionQuickActionsLayout";
import type { SessionQuickActionCatalog } from "../utils/sessionQuickAssistantCatalog";

describe("sessionQuickActionsLayout", () => {
  test("merge keeps user order and fills missing catalog ids", () => {
    const merged = mergeSessionQuickActionsLayout({
      version: 1,
      items: [
        { id: "compact-context", visible: true, zone: "primary" },
        { id: "push", visible: false, zone: "primary" },
      ],
    });
    expect(merged.items[0]?.id).toBe("compact-context");
    expect(merged.items.some((item) => item.id === "new-session")).toBe(true);
  });

  test("merge fills in new catalog ids as visible overflow items", () => {
    // 「对话助手」下线后，新保存的 dispatch_direct 模板会通过 catalog 暴露
    // 新 id；merge 必须把这种未持久化的 id 默认 visible=true / zone=overflow，
    // 否则「更多」弹窗拿不到这个模板项。
    const catalog: SessionQuickActionCatalog = {
      order: ["new-session", "push", "compact-context", "custom:immediate"],
      meta: {
        "new-session": { id: "new-session", label: "新建会话", pillLabel: "新建会话" },
        push: { id: "push", label: "推送", pillLabel: "推送" },
        "compact-context": { id: "compact-context", label: "压缩上下文", pillLabel: "压缩上下文" },
        "custom:immediate": { id: "custom:immediate", label: "立即执行", pillLabel: "立即执行" },
      },
    };
    const merged = mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, catalog);
    const item = merged.items.find((row) => row.id === "custom:immediate");
    expect(item).toBeDefined();
    expect(item?.visible).toBe(true);
    expect(item?.zone).toBe("overflow");
  });

  test("partition surfaces new catalog ids into overflow", () => {
    // 端到端：从 layout + catalog → partition 后新加的 custom id 必须出现在 overflow。
    const catalog: SessionQuickActionCatalog = {
      order: ["new-session", "push", "custom:immediate"],
      meta: {
        "new-session": { id: "new-session", label: "新建会话", pillLabel: "新建会话" },
        push: { id: "push", label: "推送", pillLabel: "推送" },
        "custom:immediate": { id: "custom:immediate", label: "立即执行", pillLabel: "立即执行" },
      },
    };
    const merged = mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, catalog);
    const { overflow } = partitionSessionQuickActions(merged, {
      canNewSession: true,
      canCompactContext: false,
    }, catalog);
    expect(overflow).toContain("custom:immediate");
  });

  test("partition respects visibility zone and availability", () => {
    const layout = updateLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "push", {
      zone: "overflow",
    });
    const { primary, overflow } = partitionSessionQuickActions(layout, {
      canNewSession: false,
      canCompactContext: true,
    });
    expect(overflow).toContain("push");
    expect(primary).not.toContain("new-session");
    expect(primary).not.toContain("push");
  });

  test("moveLayoutItem swaps neighbors", () => {
    const next = moveLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "push", "down");
    const index = next.items.findIndex((item) => item.id === "push");
    expect(next.items[index]?.id).toBe("push");
    expect(next.items[index - 1]?.id).toBe("compact-context");
  });
});
