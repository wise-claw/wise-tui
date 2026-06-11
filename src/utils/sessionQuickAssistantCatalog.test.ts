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
      assistant({ id: "builtin:prd-split", name: "需求拆分助手", source: "builtin" }),
      assistant({ id: "custom:writer", name: "写作助手", customId: "writer" }),
      assistant({ id: "ext-polish", name: "润色助手", source: "extension", extensionId: "kit" }),
    ]);

    expect(catalog.order).toContain("builtin:prd-split");
    expect(catalog.order).toContain("custom:writer");
    expect(catalog.order).toContain("ext-polish");
    expect(catalog.meta["custom:writer"]?.label).toBe("写作助手");
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
