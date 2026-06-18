import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantKind } from "../CockpitSurface/assistantKind";

export type AssistantHubFilter = "all" | "builtin" | "custom" | "extension";

export interface AssistantHubSection {
  key: string;
  title: string;
  assistants: AssistantEntry[];
}

export function filterAssistantsByHubTab(
  list: AssistantEntry[],
  filter: AssistantHubFilter,
): AssistantEntry[] {
  if (filter === "all") return list;
  return list.filter((a) => a.source === filter);
}

/** 与 Cockpit 助手 Hub 一致的分组；筛选为 custom/extension 时合并为单节。 */
export function buildAssistantHubSections(
  list: AssistantEntry[],
  filter: AssistantHubFilter,
): AssistantHubSection[] {
  const filtered = filterAssistantsByHubTab(list, filter);

  if (filter === "custom") {
    return filtered.length > 0
      ? [{ key: "custom", title: "自定义", assistants: filtered }]
      : [];
  }
  if (filter === "extension") {
    return filtered.length > 0
      ? [{ key: "extension", title: "扩展贡献", assistants: filtered }]
      : [];
  }

  const builtinAssistants = filtered.filter((a) => a.source === "builtin");
  const otherAssistants = filtered.filter((a) => a.source !== "builtin");
  const sections: AssistantHubSection[] = [];

  const trellis = builtinAssistants.filter(
    (a) => resolveAssistantKind(a) === "workflow-orchestration",
  );
  if (trellis.length > 0) {
    sections.push({ key: "trellis", title: "研发编排", assistants: trellis });
  }

  const otherBuiltin = builtinAssistants.filter(
    (a) => resolveAssistantKind(a) !== "workflow-orchestration",
  );
  if (otherBuiltin.length > 0) {
    sections.push({ key: "general", title: "其他内置", assistants: otherBuiltin });
  }

  if (otherAssistants.length > 0) {
    sections.push({ key: "other", title: "自建与扩展", assistants: otherAssistants });
  }

  return sections;
}
