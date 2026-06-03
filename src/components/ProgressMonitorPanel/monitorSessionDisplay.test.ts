import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import {
  buildMonitorSessionDrawerContextModel,
  buildMonitorSessionDrawerHeadline,
  buildMonitorSessionListRowModel,
  resolveMonitorSessionRepoShortLabel,
  resolveMonitorSessionTerminalLabel,
} from "./monitorSessionDisplay";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    repositoryName: "",
    repositoryPath: "/repo",
    status: "completed",
    messages: [],
    createdAt: Date.now(),
    pendingPrompt: "",
    ...partial,
  };
}

describe("resolveMonitorSessionTerminalLabel", () => {
  test("parses employee suffix from repository tab name", () => {
    const label = resolveMonitorSessionTerminalLabel(
      session({
        id: "s1",
        repositoryName: "eco-ai-web/员工:终端01",
      }),
    );
    expect(label).toBe("终端01");
  });
});

describe("resolveMonitorSessionRepoShortLabel", () => {
  test("strips employee segment and keeps repo leaf", () => {
    expect(
      resolveMonitorSessionRepoShortLabel(
        session({ id: "s1", repositoryName: "eco-ai-web/员工:终端01" }),
      ),
    ).toBe("eco-ai-web");
  });
});

describe("buildMonitorSessionDrawerHeadline", () => {
  test("prefers explicit terminal name", () => {
    expect(
      buildMonitorSessionDrawerHeadline(
        session({
          id: "wise-1",
          repositoryName: "open-meteo/员工:终端01",
        }),
        { terminalName: "终端01" },
      ),
    ).toBe("终端01 · 会话记录");
  });
});

describe("buildMonitorSessionDrawerContextModel", () => {
  test("exposes repo time and compact session id", () => {
    const ctx = buildMonitorSessionDrawerContextModel(
      session({
        id: "wise-1",
        claudeSessionId: "claude-abcdefghijklmnopqrstuvwxyz-123456789",
        repositoryName: "open-meteo/员工:终端01",
      }),
    );
    expect(ctx.repoShort).toBe("open-meteo");
    expect(ctx.sessionIdDisplay).toContain("…");
  });
});

describe("buildMonitorSessionListRowModel", () => {
  test("includes status and employee context", () => {
    const model = buildMonitorSessionListRowModel(
      session({
        id: "s2",
        status: "running",
        repositoryName: "wise/员工:Bot",
      }),
      { employeeName: "Bot" },
    );
    expect(model.statusLabel).toBe("运行中");
    expect(model.terminalLabel).toBe("Bot");
  });
});
