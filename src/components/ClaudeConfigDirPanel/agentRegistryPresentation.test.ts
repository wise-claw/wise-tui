import { describe, expect, test } from "bun:test";
import type { DetectedAgent } from "../../types/detectedAgent";
import {
  deriveAgentRegistryStats,
  describeAgentRuntime,
  filterAgents,
  formatDetectedAt,
  getAgentKindLabel,
  getAgentPathLabel,
  getEmptyDescription,
} from "./agentRegistryPresentation";

const agents = [
  {
    id: "claude",
    name: "Claude Code",
    kind: "claude",
    available: true,
    backend: "claude",
    binaryPath: "/usr/local/bin/claude",
    command: "claude",
    detectedAt: "2026-05-17T00:00:00.000Z",
  },
  {
    id: "codex",
    name: "Codex CLI",
    kind: "codex",
    available: false,
    backend: "codex",
    command: "codex",
    detectedAt: "2026-05-17T00:00:00.000Z",
    failureReason: "command not found",
  },
  {
    id: "custom:local",
    name: "Local Agent",
    kind: "custom",
    available: true,
    backend: "custom",
    command: "/opt/wise/local-agent",
    args: ["--stdio", "--profile", "team"],
    env: { WISE_PROFILE: "team" },
    detectedAt: "2026-05-17T00:00:00.000Z",
  },
] satisfies DetectedAgent[];

describe("agent registry presentation helpers", () => {
  test("derives summary counters for execution engine states", () => {
    expect(deriveAgentRegistryStats(agents)).toEqual({
      total: 3,
      available: 2,
      custom: 1,
      builtin: 2,
      unavailable: 1,
    });
  });

  test("filters by availability, custom source, errors, and search text", () => {
    expect(filterAgents(agents, "available", "").map((agent) => agent.id)).toEqual(["claude", "custom:local"]);
    expect(filterAgents(agents, "custom", "").map((agent) => agent.id)).toEqual(["custom:local"]);
    expect(filterAgents(agents, "errors", "").map((agent) => agent.id)).toEqual(["codex"]);
    expect(filterAgents(agents, "all", "WISE_PROFILE").map((agent) => agent.id)).toEqual(["custom:local"]);
    expect(filterAgents(agents, "all", "command not found").map((agent) => agent.id)).toEqual(["codex"]);
  });

  test("returns Chinese empty-state descriptions for every filter", () => {
    expect(getEmptyDescription("all", "")).toBe("暂未探测到执行引擎");
    expect(getEmptyDescription("available", "")).toBe("当前没有可用执行引擎，请重新探测或新增自定义命令");
    expect(getEmptyDescription("custom", "")).toBe("还没有自定义执行入口");
    expect(getEmptyDescription("errors", "")).toBe("没有异常执行引擎");
    expect(getEmptyDescription("all", "claude")).toBe("没有匹配的执行引擎");
  });

  test("formats labels, runtime descriptions, paths, and invalid dates", () => {
    expect(getAgentKindLabel("claude")).toBe("Claude");
    expect(getAgentKindLabel("codex")).toBe("Codex");
    expect(getAgentKindLabel("gemini")).toBe("Gemini");
    expect(getAgentKindLabel("custom")).toBe("自定义");
    expect(getAgentPathLabel(agents[0])).toBe("/usr/local/bin/claude");
    expect(getAgentPathLabel(agents[1])).toBe("command not found");
    expect(getAgentPathLabel(agents[2])).toBe("/opt/wise/local-agent");
    expect(describeAgentRuntime(agents[0])).toContain("可参与团队协作 / 定时自动化调度");
    expect(describeAgentRuntime(agents[0])).not.toContain("配置目录");
    expect(describeAgentRuntime(agents[1])).toContain("等待本机命令就绪");
    expect(describeAgentRuntime(agents[2])).toBe("自定义命令 · 3 个默认参数 · 1 个环境变量");
    expect(formatDetectedAt("not-a-date")).toBe("未记录");
  });
});
