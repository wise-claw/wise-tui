import type { AssistantEntry } from "../../types/assistant";
import type { AssistantKind } from "../CockpitSurface/assistantKind";

export function labelForAssistantSource(source: AssistantEntry["source"]): string {
  switch (source) {
    case "builtin":
      return "内置";
    case "custom":
      return "自定义";
    case "extension":
      return "扩展";
  }
}

export function cardSourceLabel(source: AssistantEntry["source"], kind: AssistantKind): string {
  if (source !== "builtin") return labelForAssistantSource(source);
  switch (kind) {
    case "trellis-orchestration":
      return "Wise 内置编排";
    case "office-doc":
    case "office-deck":
    case "skill-artifact":
      return "Wise 内置 Skill";
    case "general":
      return "Wise 内置";
  }
}
