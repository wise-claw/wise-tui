import type { AssistantEntry } from "../../types/assistant";

export type AssistantKind =
  | "workflow-orchestration"
  | "office-doc"
  | "office-deck"
  | "skill-artifact"
  | "general";

export function resolveAssistantKind(
  assistant: Pick<AssistantEntry, "id" | "defaultWorkflows" | "defaultSkills">,
): AssistantKind {
  if ((assistant.defaultWorkflows?.length ?? 0) > 0) {
    return "workflow-orchestration";
  }
  if (hasDefaultSkill(assistant, "officecli-docx")) {
    return "office-doc";
  }
  if (hasDefaultSkill(assistant, "officecli-pptx")) {
    return "office-deck";
  }
  if ((assistant.defaultSkills?.length ?? 0) > 0) {
    return "skill-artifact";
  }
  return "general";
}

export function isOfficeAssistantKind(kind: AssistantKind): boolean {
  return kind === "office-doc" || kind === "office-deck";
}

function hasDefaultSkill(
  assistant: Pick<AssistantEntry, "defaultSkills">,
  skillId: string,
): boolean {
  return assistant.defaultSkills?.some((skill) => skill.id === skillId) ?? false;
}
