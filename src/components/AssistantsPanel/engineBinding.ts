import type { AssistantEntry } from "../../types/assistant";
import type { DetectedAgent } from "../../types/detectedAgent";

export type AssistantEngineBindingTone = "success" | "warning" | "danger";
export type AssistantEngineBindingDot = "on" | "warn" | "off";

export interface AssistantEngineBindingStatus {
  engineId: string;
  label: "Claude Code 就绪" | "Codex CLI 就绪" | "预留入口未检测" | "运行入口不可用";
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
      label: "预留入口未检测",
      tone: "warning",
      dotTone: "warn",
      detail: "运行入口未登记",
    };
  }

  if (!agent.available) {
    return {
      engineId,
      label: "运行入口不可用",
      tone: "danger",
      dotTone: "off",
      detail: agent.failureReason?.trim() || agent.name,
    };
  }

  return {
    engineId,
    label:
      agent.kind === "claude"
        ? "Claude Code 就绪"
        : agent.kind === "codex"
          ? "Codex CLI 就绪"
          : "预留入口未检测",
    tone: agent.kind === "claude" || agent.kind === "codex" ? "success" : "warning",
    dotTone: agent.kind === "claude" || agent.kind === "codex" ? "on" : "warn",
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
      if (status.label === "Claude Code 就绪" || status.label === "Codex CLI 就绪") {
        summary.available += 1;
      } else if (status.label === "运行入口不可用") {
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
