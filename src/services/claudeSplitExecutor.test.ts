import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock<(cmd: string, args?: unknown) => Promise<unknown>>(async () => ({
  runId: "run-1",
  status: "succeeded",
  exitCode: 0,
  durationMs: 10,
  stdoutPath: "/tmp/stdout.log",
  stderrPath: "/tmp/stderr.log",
  rawResultPath: "/tmp/raw.json",
  notesPath: null,
}));

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { runPrdSplitClaude } from "./claudeSplitExecutor";

beforeEach(() => {
  invokeMock.mockClear();
});

describe("claudeSplitExecutor", () => {
  test("runPrdSplitClaude does not pass assistant skill bundles into the one-shot Claude CLI", async () => {
    await runPrdSplitClaude({
      projectPath: "/repo",
      runDir: "/tmp/run",
      prompt: "split this PRD",
      timeoutMs: 1000,
      skillBundleJson: "{\"custom\":[{\"id\":\"builtin:wise-requirement-splitter\"}]}",
    } as Parameters<typeof runPrdSplitClaude>[0] & { skillBundleJson: string });

    expect(invokeMock).toHaveBeenCalledWith("run_prd_split_claude", {
      projectPath: "/repo",
      runDir: "/tmp/run",
      prompt: "split this PRD",
      model: null,
      timeoutMs: 1000,
    });
  });
});
