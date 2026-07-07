import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../types/assistant";
import {
  buildSessionQuickActionCatalog,
  defaultQuickActionItemForId,
} from "./sessionQuickAssistantCatalog";

function assistant(partial: Partial<AssistantEntry> & Pick<AssistantEntry, "id" | "name">): AssistantEntry {
  return {
    source: "custom",
    description: "",
    avatarColor: null,
    engineId: "claude",
    model: null,
    systemPrompt: "prompt",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("sessionQuickAssistantCatalog", () => {
  test("includes custom and extension assistants in catalog order", () => {
    const catalog = buildSessionQuickActionCatalog([
      assistant({ id: "builtin:word-doc", name: "文档助手", source: "builtin" }),
      assistant({ id: "custom:writer", name: "写作助手", customId: "writer" }),
      assistant({ id: "ext-polish", name: "润色助手", source: "extension", extensionId: "kit" }),
    ]);

    expect(catalog.order).toContain("builtin:word-doc");
    expect(catalog.order).toContain("custom:writer");
    expect(catalog.order).toContain("ext-polish");
    expect(catalog.meta["custom:writer"]?.label).toBe("写作助手");
  });

  test("dispatch_direct custom assistants also appear in catalog", () => {
    // 「对话助手」下线后，新保存的「立即执行」(dispatch_direct) 模板必须
    // 出现在 catalog 中，否则「更多」弹窗拿不到这个 id。
    const catalog = buildSessionQuickActionCatalog([
      assistant({
        id: "custom:immediate",
        name: "立即执行助手",
        customId: "immediate",
        entryKind: "dispatch_direct",
      }),
    ]);
    expect(catalog.order).toContain("custom:immediate");
    expect(catalog.meta["custom:immediate"]?.label).toBe("立即执行助手");
  });

  test("new assistant templates default visible in overflow menu", () => {
    expect(defaultQuickActionItemForId("custom:writer")).toEqual({
      visible: true,
      zone: "overflow",
    });
    expect(defaultQuickActionItemForId("ext-polish")).toEqual({
      visible: true,
      zone: "overflow",
    });
  });
});
