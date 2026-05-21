import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../../types/assistant";
import { buildAssistantHubSections } from "./groupAssistants";

function row(partial: Partial<AssistantEntry> & Pick<AssistantEntry, "id" | "source" | "name">): AssistantEntry {
  return {
    description: "",
    avatarColor: null,
    engineId: "claude",
    model: null,
    systemPrompt: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("buildAssistantHubSections", () => {
  test("groups builtin assistants into hub sections", () => {
    const list: AssistantEntry[] = [
      row({ id: "builtin:prd-split", source: "builtin", name: "需求拆分", defaultWorkflows: [{ id: "w", label: "W" }] }),
      row({ id: "builtin:code-review", source: "builtin", name: "代码审查" }),
      row({ id: "custom:x", source: "custom", name: "自定义", customId: "x" }),
    ];

    const sections = buildAssistantHubSections(list, "all");
    expect(sections.map((s) => s.title)).toEqual(["研发编排", "研发助手", "自建与扩展"]);
    expect(sections[0]?.assistants[0]?.id).toBe("builtin:prd-split");
    expect(sections[2]?.assistants[0]?.id).toBe("custom:x");
  });

  test("custom filter uses a single section", () => {
    const list = [row({ id: "custom:a", source: "custom", name: "A", customId: "a" })];
    const sections = buildAssistantHubSections(list, "custom");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe("自定义");
  });
});
