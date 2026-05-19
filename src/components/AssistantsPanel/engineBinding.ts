import type { AssistantEntry } from "../../types/assistant";
import type { DetectedAgent } from "../../types/detectedAgent";

export type AssistantEngineBindingTone = "success" | "warning" | "danger";
export type AssistantEngineBindingDot = "on" | "warn" | "off";

export interface AssistantEngineBindingStatus {
  engineId: string;
  label: "引擎可用" | "未检测" | "不可用";
  tone: AssistantEngineBindingTone;
  dotTone: AssistantEngineBindingDot;
  detail: string;
}

export interface AssistantEngineBindingSummary {
  available: number;
  unavailable: number;
  undetected: number;
}

export function buildAgentEngineIndex(agents: DetectedAgent[]): Map<string, DetectedAgent> {
  const index = new Map<string, DetectedAgent>();
  for (const agent of agents) {
    for (const key of [agent.backend, agent.id, agent.command]) {
      const normalized = normalizeEngineKey(key);
      if (normalized && !index.has(normalized)) {
        index.set(normalized, agent);
      }
    }
  }
  return index;
}

export function resolveAssistantEngineBinding(
  assistant: Pick<AssistantEntry, "engineId">,
  agentIndex: ReadonlyMap<string, DetectedAgent>,
): AssistantEngineBindingStatus {
  const engineId = assistant.engineId.trim();
  const agent = agentIndex.get(normalizeEngineKey(engineId));

  if (!agent) {
    return {
      engineId,
      label: "未检测",
      tone: "warning",
      dotTone: "warn",
      detail: "执行入口未登记",
    };
  }

  if (!agent.available) {
    return {
      engineId,
      label: "不可用",
      tone: "danger",
      dotTone: "off",
      detail: agent.failureReason?.trim() || agent.name,
    };
  }

  return {
    engineId,
    label: "引擎可用",
    tone: "success",
    dotTone: "on",
    detail: agent.name,
  };
}

export function summarizeAssistantEngineBindings(
  assistants: AssistantEntry[],
  agentIndex: ReadonlyMap<string, DetectedAgent>,
): AssistantEngineBindingSummary {
  return assistants.reduce<AssistantEngineBindingSummary>(
    (summary, assistant) => {
      const status = resolveAssistantEngineBinding(assistant, agentIndex);
      if (status.label === "引擎可用") {
        summary.available += 1;
      } else if (status.label === "不可用") {
        summary.unavailable += 1;
      } else {
        summary.undetected += 1;
      }
      return summary;
    },
    { available: 0, unavailable: 0, undetected: 0 },
  );
}

function normalizeEngineKey(value: string): string {
  return value.trim().toLowerCase();
}
