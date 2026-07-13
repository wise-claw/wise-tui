import { isAgentKind, type DetectedAgent, type DetectedAgentKind, type LatestVersionInfo } from "../../types/detectedAgent";

export type BuiltinInstallableKind = Exclude<DetectedAgentKind, "custom" | "cursor">;
export type BuiltinUninstallableKind = Exclude<DetectedAgentKind, "custom">;

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

export function isBuiltinInstallableAgent(
  agent: DetectedAgent,
): agent is DetectedAgent<BuiltinInstallableKind> {
  return agent.kind !== "custom" && agent.kind !== "cursor";
}

export function isBuiltinUninstallableAgent(
  agent: DetectedAgent,
): agent is DetectedAgent<BuiltinUninstallableKind> {
  return agent.kind !== "custom";
}

export function canInstallBuiltinAgent(agent: DetectedAgent): boolean {
  return isBuiltinInstallableAgent(agent) && !agent.available;
}

export function canUninstallBuiltinAgent(agent: DetectedAgent): boolean {
  return isBuiltinUninstallableAgent(agent) && agent.available;
}

export function canUpdateBuiltinAgent(agent: DetectedAgent): boolean {
  return isBuiltinInstallableAgent(agent) && agent.available;
}

export function getBuiltinInstallCommand(kind: BuiltinInstallableKind): string {
  switch (kind) {
    case "claude":
      return "npm install -g @anthropic-ai/claude-code";
    case "codex":
      return "npm install -g @openai/codex";
    case "gemini":
      return "npm install -g @google/gemini-cli";
    case "opencode":
      return "npm install -g opencode-ai@latest";
  }
}

export function getBuiltinUninstallCommand(kind: BuiltinUninstallableKind): string {
  if (kind === "cursor") {
    return "清除 Cursor API Key（本地 app_settings）";
  }
  return getBuiltinInstallCommand(kind).replace("npm install -g", "npm uninstall -g");
}

export function getBuiltinUpdateCommand(kind: BuiltinInstallableKind): string {
  return getBuiltinInstallCommand(kind);
}

export function getAgentKindLabel(kind: DetectedAgent["kind"]): string {
  switch (kind) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor SDK";
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
  const runtimeScope =
    agent.kind === "claude"
      ? "当前主运行时"
      : agent.kind === "cursor"
        ? "Cursor SDK 可编程引擎"
        : "未来运行入口预留";
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

// ──────────────────── 版本展示 ────────────────────

export type VersionStatusTone = "neutral" | "upgradable" | "current" | "manual" | "checking" | "unknown";

export interface VersionStatusBadge {
  /** 主文本,如 "v1.2.3" / "v1.2.3 → v1.4.0 可更新" / "已是最新" / "手动更新"。 */
  text: string;
  /** 描述最新版本号(若有,用于在 metadata 行右侧次级展示)。 */
  latestHint?: string;
  tone: VersionStatusTone;
}

/**
 * 合成卡片底部版本 metadata 的展示文案。
 *
 * - installed 为空(本机未探测到)→ 不展示,返回 `null`(由调用方隐藏整行)。
 * - latest 为 manual → 显示「手动更新」。
 * - latest 查询失败 / latest 为 null → 显示「查询失败」+ installed。
 * - installed === latest → 显示「v{installed} · 已是最新」。
 * - installed !== latest → 显示「v{installed} → v{latest} 可更新」。
 */
export function describeVersionStatus(
  installedVersion: string | undefined,
  latest: LatestVersionInfo | undefined,
): VersionStatusBadge | null {
  if (!installedVersion) return null;
  if (!latest) {
    return { text: `v${installedVersion}`, tone: "neutral" };
  }
  if (latest.manual) {
    return { text: `v${installedVersion} · 手动更新`, tone: "manual" };
  }
  if (!latest.latest) {
    return { text: `v${installedVersion} · 查询失败`, tone: "unknown" };
  }
  if (latest.installed && latest.installed === latest.latest) {
    return { text: `v${installedVersion} · 已是最新`, tone: "current" };
  }
  return {
    text: `v${installedVersion} → v${latest.latest} 可更新`,
    latestHint: `v${latest.latest}`,
    tone: "upgradable",
  };
}

/** 当前是否无可更新 — 用于把「一键更新」按钮置灰。 */
export function isUpToDateBuiltinAgent(
  latest: LatestVersionInfo | undefined,
): boolean {
  if (!latest) return false;
  if (latest.manual) return true;
  if (!latest.upgradable) return true;
  return false;
}
