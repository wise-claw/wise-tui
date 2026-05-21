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
    (a) => resolveAssistantKind(a) === "trellis-orchestration",
  );
  if (trellis.length > 0) {
    sections.push({ key: "trellis", title: "研发编排", assistants: trellis });
  }

  const engineering = builtinAssistants.filter(
    (a) => resolveAssistantKind(a) === "engineering",
  );
  if (engineering.length > 0) {
    sections.push({ key: "engineering", title: "研发助手", assistants: engineering });
  }

  const skill = builtinAssistants.filter((a) => {
    const kind = resolveAssistantKind(a);
    return kind === "office-doc" || kind === "office-deck" || kind === "skill-artifact";
  });
  if (skill.length > 0) {
    sections.push({ key: "skill", title: "内置 Skill 产物", assistants: skill });
  }

  const general = builtinAssistants.filter((a) => resolveAssistantKind(a) === "general");
  if (general.length > 0) {
    sections.push({ key: "general", title: "其他内置", assistants: general });
  }

  if (otherAssistants.length > 0) {
    sections.push({ key: "other", title: "自建与扩展", assistants: otherAssistants });
  }

  return sections;
}
