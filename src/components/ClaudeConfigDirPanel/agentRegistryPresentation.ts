import { isAgentKind, type DetectedAgent, type DetectedAgentKind } from "../../types/detectedAgent";

export type BuiltinInstallableKind = Exclude<DetectedAgentKind, "custom">;

export type AgentRegistryFilter = "all" | "available" | "custom" | "errors";

export function deriveAgentRegistryStats(agents: DetectedAgent[]) {
  const available = agents.filter((agent) => agent.available).length;
  const custom = agents.filter((agent) => agent.kind === "custom").length;
  return {
    total: agents.length,
    available,
    custom,
    builtin: agents.length - custom,
    unavailable: agents.length - available,
  };
}

export function filterAgents(
  agents: DetectedAgent[],
  filter: AgentRegistryFilter,
  query: string,
): DetectedAgent[] {
  const normalizedQuery = query.trim().toLowerCase();
  return agents.filter((agent) => {
    if (filter === "available" && !agent.available) return false;
    if (filter === "custom" && agent.kind !== "custom") return false;
    if (filter === "errors" && agent.available) return false;
    if (!normalizedQuery) return true;
    return buildAgentSearchText(agent).includes(normalizedQuery);
  });
}

export function getEmptyDescription(filter: AgentRegistryFilter, query: string): string {
  if (query.trim()) return "没有匹配的运行入口";
  if (filter === "available") return "当前没有可用运行入口，请重新探测或新增预留命令";
  if (filter === "custom") return "还没有自定义预留入口";
  if (filter === "errors") return "没有异常运行入口";
  return "暂未探测到 Claude Code 运行入口";
}

export function canInstallBuiltinAgent(
  agent: DetectedAgent,
): agent is DetectedAgent<BuiltinInstallableKind> {
  return agent.kind !== "custom" && !agent.available;
}

export function getBuiltinInstallCommand(kind: BuiltinInstallableKind): string {
  switch (kind) {
    case "claude":
      return "npm install -g @anthropic-ai/claude-code";
    case "codex":
      return "npm install -g @openai/codex";
    case "gemini":
      return "npm install -g @google/gemini-cli";
  }
}

export function getAgentKindLabel(kind: DetectedAgent["kind"]): string {
  switch (kind) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "custom":
      return "自定义";
  }
}

export function getAgentPathLabel(agent: DetectedAgent): string {
  if (agent.binaryPath) return agent.binaryPath;
  if (isAgentKind(agent, "custom")) return agent.command;
  return agent.failureReason ?? "未找到命令路径";
}

export function describeAgentRuntime(agent: DetectedAgent): string {
  if (isAgentKind(agent, "custom")) {
    const args = agent.args.length === 0 ? "无默认参数" : `${agent.args.length} 个默认参数`;
    const env = Object.keys(agent.env).length;
    return `预留命令 · ${args} · ${env} 个环境变量`;
  }
  const runtimeScope = agent.kind === "claude" ? "当前主运行时" : "未来运行入口预留";
  return `自动探测 · ${agent.command} · ${runtimeScope} · ${agent.available ? "本机命令就绪" : "等待本机命令就绪"}`;
}

export function formatDetectedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function buildAgentSearchText(agent: DetectedAgent): string {
  const customText = isAgentKind(agent, "custom")
    ? [agent.command, agent.args.join(" "), Object.keys(agent.env).join(" ")]
    : [agent.command];
  return [
    agent.id,
    agent.name,
    agent.kind,
    agent.backend,
    agent.binaryPath,
    agent.failureReason,
    ...customText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
