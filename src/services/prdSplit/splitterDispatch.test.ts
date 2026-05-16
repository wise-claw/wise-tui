import { describe, expect, mock, test } from "bun:test";
import type { PrdDocument, TaskSplitContext } from "../../types";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";
import {
  composeSplitterPrompt,
  dispatchClusterSplit,
  retryClusterFromRunDir,
  type DispatchClusterRawOutput,
} from "./splitterDispatch";

const cluster = {
  id: "cluster-fe-1",
  title: "Frontend cluster",
  primaryRepositoryId: 7,
  repositoryIds: [7],
  requirementIds: ["req-functional-1"],
  dependencyClusterIds: [],
};

describe("composeSplitterPrompt", () => {
  test("starts with the strict `Active task:` prefix", () => {
    const prompt = composeSplitterPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      bundleFileNames: ["prd.md", "cluster.json"],
    });
    expect(prompt.split("\n")[0]).toBe("Active task: .trellis/tasks/05-13-parent");
  });

  test("lists each bundle file and includes cluster meta", () => {
    const prompt = composeSplitterPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      bundleFileNames: ["prd.md", "requirements-index.json", "cluster.json", "OUTPUT_SCHEMA.json"],
    });
    expect(prompt).toContain("`cluster-fe-1`");
    expect(prompt).toContain("primaryRepositoryId: 7");
    expect(prompt).toContain("- `prd.md`");
    expect(prompt).toContain("- `OUTPUT_SCHEMA.json`");
    expect(prompt).toContain("exactly one top-level JSON object");
  });

  test("embeds bundle contents and forbids tool calls", () => {
    const prompt = composeSplitterPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      bundleFileNames: ["prd.md", "cluster.json"],
      bundle: {
        "prd.md": "# Feature\n\nBuild selected UI",
        "cluster.json": JSON.stringify({ id: "cluster-fe-1" }),
      },
    });

    expect(prompt).toContain("Do not call tools");
    expect(prompt).toContain("## Embedded input bundle");
    expect(prompt).toContain("### prd.md");
    expect(prompt).toContain("# Feature");
    expect(prompt).toContain("final assistant response must be the JSON object itself");
  });
});

describe("dispatchClusterSplit", () => {
  test("validates splitter output against the cluster PRD slice", async () => {
    const raw: DispatchClusterRawOutput = {
      runId: "run-1",
      runDir: "/tmp/run-1",
      exitCode: 0,
      durationMs: 1,
      stdoutPath: "/tmp/run-1/claude.stdout.log",
      stderrPath: "/tmp/run-1/claude.stderr.log",
      rawResultPath: "/tmp/run-1/split-result.raw.json",
      claudeSessionId: "sid-1",
      stdoutTruncatedPreview: "",
      rawOutput: {
        tasks: [
          {
            id: "task-1",
            title: "Implement selected requirement",
            description: "Implement the cluster-scoped requirement.",
            role: "frontend",
            executionStatus: "executable",
            missingPrerequisites: [],
            subtasks: ["Build the UI"],
            dod: ["The selected requirement is implemented"],
            dependencies: [],
            sourceRequirementIds: ["req-functional-1"],
            taskAnchors: {
              from: 0,
              to: 18,
              textHash: "hash",
              contextBefore: "Build selected UI",
              contextAfter: "Build selected UI",
            },
            clusterId: "cluster-fe-1",
          },
        ],
      },
    };
    const invoke = mock(async () => raw);
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const prd: PrdDocument = {
      title: "Feature",
      sourceType: "manual",
      sourceRef: null,
      background: [],
      goals: [],
      scenarios: [],
      functional: ["Build selected UI", "Build unrelated backend"],
      nonFunctional: [],
      acceptance: [],
    };
    const requirementsIndex: RequirementsIndexV2 = {
      schemaVersion: 2,
      version: "v1",
      requirements: [
        { id: "req-functional-1", content: "Build selected UI", bodyHash: "aaaaaaaaaaaaaaaa" },
        { id: "req-functional-2", content: "Build unrelated backend", bodyHash: "bbbbbbbbbbbbbbbb" },
      ],
    };
    const context: TaskSplitContext = {
      mode: "repository",
      repositoryId: 1,
      repositoryName: "web",
      repositoryPath: "/repo/web",
      repositoryType: "frontend",
    };

    const result = await dispatchClusterSplit({
      projectRootPath: "/repo",
      parentTaskPath: ".trellis/tasks/parent",
      cluster,
      prd,
      requirementsIndex,
      context,
    });

    expect(result.errors).toEqual([]);
    expect(result.validationIssues).toEqual([]);
    expect(result.normalized?.splitTasks[0]?.sourceRequirementIds).toEqual(["req-functional-1"]);
    expect(result.raw.claudeSessionId).toBe("sid-1");
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      input: {
        timeoutMs: 0,
      },
    });
  });

  test("reports run artifact paths when Claude output has no JSON payload", async () => {
    const raw: DispatchClusterRawOutput = {
      runId: "run-2",
      runDir: "/tmp/run-2",
      exitCode: 0,
      durationMs: 1,
      stdoutPath: "/tmp/run-2/claude.stdout.log",
      stderrPath: "/tmp/run-2/claude.stderr.log",
      rawResultPath: "/tmp/run-2/split-result.raw.json",
      claudeSessionId: "sid-2",
      stdoutTruncatedPreview: "Validation passed. Outputting the final JSON:",
      rawOutput: null,
    };
    const invoke = mock(async () => raw);
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await dispatchClusterSplit({
      projectRootPath: "/repo",
      parentTaskPath: ".trellis/tasks/parent",
      cluster,
      prd: {
        title: "Feature",
        sourceType: "manual",
        sourceRef: null,
        background: [],
        goals: [],
        scenarios: [],
        functional: ["Build selected UI"],
        nonFunctional: [],
        acceptance: [],
      },
      requirementsIndex: {
        schemaVersion: 2,
        version: "v1",
        requirements: [
          { id: "req-functional-1", content: "Build selected UI", bodyHash: "aaaaaaaaaaaaaaaa" },
        ],
      },
      context: null,
    });

    expect(result.normalized).toBeNull();
    expect(result.errors.join("\n")).toContain("runDir: /tmp/run-2");
    expect(result.errors.join("\n")).toContain("stdout: /tmp/run-2/claude.stdout.log");
  });
});

describe("retryClusterFromRunDir", () => {
  test("wraps the retry Tauri command", async () => {
    const invoke = mock(async () => ({ newRunId: "run-2", newRunDir: "/tmp/run-2" }));
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await retryClusterFromRunDir({
      runId: "run-1",
      projectRootPath: "/repo",
      missionId: "mission-1",
      clusterId: "cluster-fe-1",
      model: "sonnet",
    });

    expect(result).toEqual({ newRunId: "run-2", newRunDir: "/tmp/run-2" });
    expect(invoke).toHaveBeenCalledWith("prd_split_retry_run", {
      input: {
        runId: "run-1",
        projectRootPath: "/repo",
        missionId: "mission-1",
        clusterId: "cluster-fe-1",
        model: "sonnet",
      },
    });
  });
});
