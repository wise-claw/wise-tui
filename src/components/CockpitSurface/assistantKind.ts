import { isEngineeringBuiltinAssistantId } from "../../constants/sessionQuickBuiltinAssistants";
import type { AssistantEntry } from "../../types/assistant";

export type AssistantKind =
  | "trellis-orchestration"
  | "office-doc"
  | "office-deck"
  | "skill-artifact"
  | "engineering"
  | "general";

export function resolveAssistantKind(
  assistant: Pick<AssistantEntry, "id" | "defaultWorkflows" | "defaultSkills">,
): AssistantKind {
  if (assistant.id === "builtin:prd-split" || (assistant.defaultWorkflows?.length ?? 0) > 0) {
    return "trellis-orchestration";
  }
  if (assistant.id === "builtin:word-doc" || hasDefaultSkill(assistant, "officecli-docx")) {
    return "office-doc";
  }
  if (assistant.id === "builtin:ppt-deck" || hasDefaultSkill(assistant, "officecli-pptx")) {
    return "office-deck";
  }
  if (isEngineeringBuiltinAssistantId(assistant.id)) {
    return "engineering";
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
