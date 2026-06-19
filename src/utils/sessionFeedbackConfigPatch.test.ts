import { describe, expect, test } from "bun:test";
import type { SessionInsightsResult } from "./sessionInsights";
import { emptyRequestRationalityMetrics, emptySessionInsightsAnalytics } from "./sessionInsights";
import {
  CLAUDE_AUTO_MEMORY_PATCH_PATH,
  buildFeedbackLoopConfigPatchPrompt,
  dedupeFeedbackConfigPatches,
  inferConfigPatchCandidates,
  mergeAppendSectionContent,
  normalizeFeedbackConfigPatch,
  parseConfigPatchesFromAiResponse,
  previewPatchContent,
  resolveFeedbackConfigPatchPath,
  resolveFeedbackConfigPatchFileTarget,
} from "./sessionFeedbackConfigPatch";
import { createInitialFeedbackLoopState } from "./sessionFeedbackLoop";

function sampleInsights(): SessionInsightsResult {
  return {
    overview: {
      totalDurationMs: 60_000,
      turnCount: 3,
      toolCallCount: 18,
      httpObservedCount: 2,
      httpInferredCount: 0,
      avgTurnDurationMs: 20_000,
      maxTurnDurationMs: 30_000,
      p95HttpLatencyMs: null,
      avgHttpLatencyMs: null,
      p95TtftMs: null,
      avgTtftMs: null,
      p95FirstByteMs: null,
      tokens: {
        inputTokens: 5000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 2000,
        costUsd: 0,
        sampleCount: 3,
      },
      cacheHitRate: 0.2,
      dataCoverage: {
        hasJsonlUsage: true,
        hasHttpUsage: false,
        hasObservedHttp: false,
        hasInferredHttp: false,
        llmProxyEnabled: false,
        fccTraceCount: 0,
        opencodeGoProxyTraceCount: 0,
        hasTtftData: false,
        hasContextMetrics: false,
      },
    },
    turnInsights: [],
    toolHotspots: [],
    slowestTurns: [],
    recommendations: [
      {
        id: "tool-high",
        severity: "warning",
        category: "tool",
        title: "工具过多",
        description: "每轮工具调用偏高",
      },
      {
        id: "token-high",
        severity: "warning",
        category: "token",
        title: "Token 偏高",
        description: "输出 token 比例高",
      },
    ],
    requestRationality: emptyRequestRationalityMetrics(),
    ...emptySessionInsightsAnalytics(),
  };
}

describe("inferConfigPatchCandidates", () => {
  test("maps tool and token recommendations to rule and claude_md patches", () => {
    const patches = inferConfigPatchCandidates({ insights: sampleInsights() });
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.some((p) => p.path.includes("rules"))).toBe(true);
    expect(patches.some((p) => p.path === "CLAUDE.md")).toBe(true);
  });

  test("suggests disable for enabled MCP servers with no session usage", () => {
    const insights = sampleInsights();
    const patches = inferConfigPatchCandidates({
      insights,
      snapshot: {
        repositoryPath: "/repo",
        capturedAt: Date.now(),
        claudeMd: { path: "CLAUDE.md", exists: false, charCount: 0, excerpt: "" },
        agentsMd: { path: "AGENTS.md", exists: false, charCount: 0, excerpt: "" },
        memoryFile: { path: "memory", exists: false, charCount: 0, excerpt: "" },
        settingsFile: { path: ".claude/settings.json", exists: true, charCount: 10, excerpt: "{}" },
        ruleFiles: [],
        skills: [],
        mcpServers: [
          {
            name: "unused-server",
            enabled: true,
            scope: "project",
            sourcePath: "/repo/.claude/settings.json",
            toolCount: 3,
          },
          {
            name: "other-server",
            enabled: true,
            scope: "project",
            sourcePath: "/repo/.claude/settings.json",
            toolCount: 2,
          },
        ],
        overhead: { rules: 100, skills: 0, mcp: 500, subagents: 0 },
      },
    });
    expect(patches.some((p) => p.kind === "mcp" && p.action === "disable")).toBe(true);
  });
});

describe("parseConfigPatchesFromAiResponse", () => {
  test("extracts patches from fenced json", () => {
    const text = [
      "说明文字",
      "```json",
      JSON.stringify({
        patches: [
          {
            kind: "claude_md",
            action: "append_section",
            path: "CLAUDE.md",
            section: "测试",
            rationale: "测试补丁",
            content: "- foo",
          },
        ],
      }),
      "```",
    ].join("\n");
    const patches = parseConfigPatchesFromAiResponse(text);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.source).toBe("ai");
    expect(patches[0]?.path).toBe("CLAUDE.md");
  });
});

describe("normalizeFeedbackConfigPatch", () => {
  test("rejects invalid entries", () => {
    expect(normalizeFeedbackConfigPatch({ kind: "nope" }, 0)).toBeNull();
    expect(
      normalizeFeedbackConfigPatch(
        {
          kind: "mcp",
          action: "enable",
          path: ".mcp.json",
          rationale: "启用 codegraph",
          content: "",
          mcp: { serverName: "codegraph", scope: "project", sourcePath: "/x/.mcp.json" },
        },
        0,
      )?.kind,
    ).toBe("mcp");
  });
});

describe("mergeAppendSectionContent", () => {
  test("appends section to existing markdown", () => {
    const out = mergeAppendSectionContent("# Root\n", "习惯", "- item");
    expect(out).toContain("## 习惯");
    expect(out).toContain("- item");
  });
});

describe("previewPatchContent", () => {
  test("create uses full content", () => {
    const patch = inferConfigPatchCandidates({ insights: sampleInsights() })[0]!;
    expect(previewPatchContent(patch, null)).toBe(patch.content);
  });
});

describe("buildFeedbackLoopConfigPatchPrompt", () => {
  test("includes config snapshot and report", () => {
    const prompt = buildFeedbackLoopConfigPatchPrompt({
      insights: sampleInsights(),
      loopState: createInitialFeedbackLoopState("s1"),
      snapshot: {
        repositoryPath: "/repo",
        capturedAt: Date.now(),
        claudeMd: { path: "CLAUDE.md", exists: true, charCount: 100, excerpt: "# Hi" },
        agentsMd: { path: "AGENTS.md", exists: false, charCount: 0, excerpt: "" },
        memoryFile: { path: ".claude/project-memory.md", exists: false, charCount: 0, excerpt: "" },
        settingsFile: { path: ".claude/settings.json", exists: false, charCount: 0, excerpt: "" },
        ruleFiles: [],
        skills: [],
        mcpServers: [],
        overhead: { rules: 100, skills: 50, mcp: 200, subagents: 0 },
      },
    });
    expect(prompt).toContain("配置 Artifact");
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("```json");
  });
});

describe("resolveFeedbackConfigPatchPath", () => {
  test("normalizes skill name to SKILL.md path", () => {
    const resolved = resolveFeedbackConfigPatchPath({
      id: "x",
      kind: "skill",
      action: "create",
      path: "my-skill",
      rationale: "r",
      content: "---\nname: my-skill\n---\n",
      source: "ai",
      status: "pending",
    });
    expect(resolved.path).toBe(".claude/skills/my-skill/SKILL.md");
  });

  test("normalizes memory alias", () => {
    const resolved = resolveFeedbackConfigPatchPath({
      id: "x",
      kind: "memory",
      action: "append_section",
      path: "memory.md",
      rationale: "r",
      content: "- note",
      source: "heuristic",
      status: "pending",
    });
    expect(resolved.path).toBe(CLAUDE_AUTO_MEMORY_PATCH_PATH);
  });
});

describe("resolveFeedbackConfigPatchFileTarget", () => {
  test("resolves repository file to absolute path", () => {
    const target = resolveFeedbackConfigPatchFileTarget(
      {
        id: "x",
        kind: "claude_md",
        action: "append_section",
        path: "CLAUDE.md",
        rationale: "r",
        content: "body",
        source: "ai",
        status: "pending",
      },
      "/Users/dev/wise-tui",
    );
    expect(target.fileName).toBe("CLAUDE.md");
    expect(target.displayPath).toBe("/Users/dev/wise-tui/CLAUDE.md");
    expect(target.openKind).toBe("repository_relative");
    expect(target.repositoryRelativePath).toBe("CLAUDE.md");
  });

  test("uses MCP source path for enable/disable patches", () => {
    const target = resolveFeedbackConfigPatchFileTarget(
      {
        id: "x",
        kind: "mcp",
        action: "enable",
        path: "my-server",
        rationale: "r",
        content: "",
        source: "ai",
        status: "pending",
        mcp: {
          serverName: "my-server",
          scope: "user",
          sourcePath: "/Users/dev/.claude/settings.json",
        },
      },
      "/Users/dev/wise-tui",
    );
    expect(target.fileName).toBe("my-server");
    expect(target.displayPath).toBe("/Users/dev/.claude/settings.json");
    expect(target.openKind).toBe("absolute");
  });
});

describe("dedupeFeedbackConfigPatches", () => {
  test("removes duplicate path/action pairs", () => {
    const base = inferConfigPatchCandidates({ insights: sampleInsights() })[0]!;
    const dup = { ...base, id: "other" };
    expect(dedupeFeedbackConfigPatches([base, dup])).toHaveLength(1);
  });
});
