import type { AssistantEntry } from "../../types/assistant";
import type { DetectedAgent } from "../../types/detectedAgent";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../../constants/sessionExecutionEngine";

export type AssistantEngineBindingTone = "success" | "warning" | "danger";
export type AssistantEngineBindingDot = "on" | "warn" | "off";

export interface AssistantEngineBindingStatus {
  engineId: string;
  label: string;
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
    // Codex RPC 使用同一个本机 codex 二进制；模板中的 codex-rpc 应映射到注册表的 codex 供给。
    const aliases = agent.kind === "codex" ? ["codex-rpc"] : [];
    // 旧模板可能存了通用的 custom；不能把它误认成列表中第一个自定义入口。
    const keys = agent.kind === "custom" ? [agent.id] : [agent.backend, agent.id, agent.command, ...aliases];
    for (const key of keys) {
      const normalized = normalizeEngineKey(key);
      if (normalized && !index.has(normalized)) {
        index.set(normalized, agent);
      }
    }
  }
  return index;
}

export function buildAssistantEngineOptions(agents: DetectedAgent[]): { value: string; label: string }[] {
  const index = buildAgentEngineIndex(agents);
  const builtins = ["claude", "codex-rpc", "cursor", "deepseek", "gemini", "opencode", "qoder", "codex"] as const;
  const options: { value: string; label: string }[] = builtins.map((id) => {
    const agent = index.get(id);
    const state = agent ? (agent.available ? "命令已探测" : "命令不可用") : "未检测到";
    const legacy = id === "codex" ? " · 旧模板兼容" : "";
    return { value: id, label: `${SESSION_EXECUTION_ENGINE_LABELS[id].title} · ${state}${legacy}` };
  });
  for (const agent of agents) {
    if (agent.kind !== "custom") continue;
    options.push({
      value: agent.id,
      label: `${agent.name} · 预留入口 · ${agent.available ? "已探测，暂不可派发" : "命令不可用"}`,
    });
  }
  return options;
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

  if (agent.kind === "custom") {
    return {
      engineId,
      label: "预留命令已探测",
      tone: "warning",
      dotTone: "warn",
      detail: "命令存在，但尚未接入会话派发",
    };
  }

  return {
    engineId,
    label: `${agent.name} 就绪`,
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
      if (status.tone === "success") {
        summary.available += 1;
      } else if (status.tone === "danger") {
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
