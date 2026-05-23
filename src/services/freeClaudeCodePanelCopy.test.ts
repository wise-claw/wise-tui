import { describe, expect, test } from "bun:test";
import { buildFccDependencyRows, buildFccSummaryMessage } from "./freeClaudeCodePanelCopy";
import type { FreeClaudeCodeStatus } from "./freeClaudeCode";

function baseStatus(overrides: Partial<FreeClaudeCodeStatus> = {}): FreeClaudeCodeStatus {
  return {
    installed: false,
    serverRunning: false,
    managedByWise: false,
    port: 8082,
    authToken: null,
    model: null,
    adminUrl: "http://127.0.0.1:8082/admin",
    proxyBaseUrl: "http://127.0.0.1:8082",
    binaryPath: null,
    repoUrl: "git+https://github.com/jiaolong1021/free-claude-code.git",
    configPath: "/Users/me/.fcc/.env",
    claudeSettingsAligned: false,
    uvReady: false,
    claudeCliReady: false,
    ...overrides,
  };
}

describe("buildFccSummaryMessage", () => {
  test("fcc installed but proxy down", () => {
    expect(buildFccSummaryMessage(baseStatus({ installed: true }))).toContain("启动");
  });

  test("proxy running", () => {
    expect(buildFccSummaryMessage(baseStatus({ installed: true, serverRunning: true }))).toContain(
      "Admin UI",
    );
  });
});

describe("buildFccDependencyRows", () => {
  test("maps readiness flags", () => {
    const rows = buildFccDependencyRows(
      baseStatus({ uvReady: true, installed: true, claudeCliReady: true, serverRunning: false }),
    );
    expect(rows.find((r) => r.id === "uv")?.ready).toBe(true);
    expect(rows.find((r) => r.id === "proxy")?.ready).toBe(false);
  });
});
