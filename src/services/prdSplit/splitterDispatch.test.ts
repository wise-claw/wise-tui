import { describe, expect, mock, test } from "bun:test";
import type { PrdDocument, TaskSplitContext } from "../../types";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";
import {
  buildLoopFeedbackBundleContent,
  composeSplitterPrompt,
  cancelClusterRun,
  dispatchClusterSplit,
  recoverClusterRunFromRunDir,
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
    expect(findDispatchClusterCall(invoke)?.[1]).toMatchObject({
      input: {
        executionRootPath: "/repo/web",
        timeoutMs: 0,
      },
    });
  });

  test("keeps original requirement ids when a cluster contains a later PRD requirement", async () => {
    const laterCluster = {
      ...cluster,
      requirementIds: ["req-functional-2"],
    };
    const raw: DispatchClusterRawOutput = {
      runId: "run-later",
      runDir: "/tmp/run-later",
      exitCode: 0,
      durationMs: 1,
      stdoutPath: "/tmp/run-later/claude.stdout.log",
      stderrPath: "/tmp/run-later/claude.stderr.log",
      rawResultPath: "/tmp/run-later/split-result.raw.json",
      claudeSessionId: "sid-later",
      stdoutTruncatedPreview: "",
      rawOutput: {
        tasks: [
          {
            id: "task-later",
            title: "Implement backend requirement",
            description: "Implement the later requirement without id renumbering.",
            role: "backend",
            executionStatus: "executable",
            missingPrerequisites: [],
            subtasks: ["Build backend"],
            dod: ["The backend requirement is implemented"],
            dependencies: [],
            sourceRequirementIds: ["req-functional-2"],
            taskAnchors: {
              from: 0,
              to: 24,
              textHash: "bbbbbbbbbbbbbbbb",
              contextBefore: "Build unrelated backend",
              contextAfter: "Build unrelated backend",
            },
            clusterId: "cluster-fe-1",
          },
        ],
      },
    };
    const invoke = mock(async () => raw);
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await dispatchClusterSplit({
      projectRootPath: "/repo",
      parentTaskPath: ".trellis/tasks/parent",
      cluster: laterCluster,
      prd: makePrd(),
      requirementsIndex: makeRequirementsIndex(),
      context: null,
    });

    expect(result.errors).toEqual([]);
    expect(result.validationIssues).toEqual([]);
    expect(result.normalized?.splitTasks[0]?.sourceRequirementIds).toEqual(["req-functional-2"]);
    const bundle = findDispatchClusterCall(invoke)?.[1]?.input?.bundle as Record<string, string>;
    const bundledIndex = JSON.parse(bundle["requirements-index.json"]);
    expect(bundledIndex.requirements.map((entry: { id: string }) => entry.id)).toEqual(["req-functional-2"]);
  });

  test("rejects splitter output that escapes the cluster requirement scope", async () => {
    const raw: DispatchClusterRawOutput = {
      runId: "run-scope",
      runDir: "/tmp/run-scope",
      exitCode: 0,
      durationMs: 1,
      stdoutPath: "/tmp/run-scope/claude.stdout.log",
      stderrPath: "/tmp/run-scope/claude.stderr.log",
      rawResultPath: "/tmp/run-scope/split-result.raw.json",
      claudeSessionId: "sid-scope",
      stdoutTruncatedPreview: "",
      rawOutput: {
        tasks: [
          {
            id: "task-out-of-scope",
            title: "Wrong scope",
            description: "Uses a requirement from another cluster.",
            role: "frontend",
            executionStatus: "executable",
            missingPrerequisites: [],
            subtasks: ["Build UI"],
            dod: ["Done"],
            dependencies: [],
            sourceRequirementIds: ["req-functional-2"],
            taskAnchors: {
              from: 0,
              to: 24,
              textHash: "bbbbbbbbbbbbbbbb",
              contextBefore: "Build unrelated backend",
              contextAfter: "Build unrelated backend",
            },
            clusterId: "cluster-fe-1",
          },
        ],
      },
    };
    const invoke = mock(async () => raw);
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await dispatchClusterSplit({
      projectRootPath: "/repo",
      parentTaskPath: ".trellis/tasks/parent",
      cluster,
      prd: makePrd(),
      requirementsIndex: makeRequirementsIndex(),
      context: null,
    });

    expect(result.normalized).toBeNull();
    expect(result.validationIssues[0]?.message).toContain("非本 cluster");
    expect(result.errors.join("\n")).toContain("非本 cluster");
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

  test("injects prior PRD loop feedback into the next splitter bundle", async () => {
    const raw: DispatchClusterRawOutput = {
      runId: "run-feedback",
      runDir: "/tmp/run-feedback",
      exitCode: 0,
      durationMs: 1,
      stdoutPath: "/tmp/run-feedback/claude.stdout.log",
      stderrPath: "/tmp/run-feedback/claude.stderr.log",
      rawResultPath: "/tmp/run-feedback/split-result.raw.json",
      claudeSessionId: "sid-feedback",
      stdoutTruncatedPreview: "",
      rawOutput: {
        tasks: [
          {
            id: "task-feedback",
            title: "Apply feedback",
            description: "Apply prior loop feedback to this split.",
            role: "frontend",
            executionStatus: "executable",
            missingPrerequisites: [],
            subtasks: ["Apply"],
            dod: ["Applied"],
            dependencies: [],
            sourceRequirementIds: ["req-functional-1"],
            taskAnchors: {
              from: 0,
              to: 18,
              textHash: "aaaaaaaaaaaaaaaa",
              contextBefore: "Build selected UI",
              contextAfter: "Build selected UI",
            },
            clusterId: "cluster-fe-1",
          },
        ],
      },
    };
    const invoke = mock(async (command: string) => {
      if (command === "trellis_read_spec_file") {
        return {
          relativePath: "guides/prd-assistant-loop-feedback.md",
          content: [
            "# PRD Assistant Loop Feedback",
            "",
            "## 2026-05-25T08:00:00.000Z - PRD Split Loop Feedback",
            "",
            "- Verify: passed 1/1; failed 0",
            "- Lesson: keep anchors exact",
          ].join("\n"),
          sizeBytes: 128,
        };
      }
      return raw;
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await dispatchClusterSplit({
      projectRootPath: "/repo",
      parentTaskPath: ".trellis/tasks/parent",
      cluster,
      prd: makePrd(),
      requirementsIndex: makeRequirementsIndex(),
      context: null,
    });

    expect(result.errors).toEqual([]);
    const dispatchCall = findDispatchClusterCall(invoke);
    const bundle = dispatchCall?.[1]?.input?.bundle as Record<string, string>;
    expect(bundle["prd-loop-feedback.md"]).toContain("keep anchors exact");
    expect(dispatchCall?.[1]?.input?.prompt).toContain("prd-loop-feedback.md");
    expect(dispatchCall?.[1]?.input?.prompt).toContain("requirements-index.json` remains the source of truth");
  });
});

describe("buildLoopFeedbackBundleContent", () => {
  test("keeps the latest bounded feedback entries as splitter guidance", () => {
    const content = [
      "# PRD Assistant Loop Feedback",
      "",
      "## 2026-05-24T08:00:00.000Z - PRD Split Loop Feedback",
      "old lesson",
      "",
      "## 2026-05-25T08:00:00.000Z - PRD Split Loop Feedback",
      "new lesson about anchors",
    ].join("\n");

    const bundle = buildLoopFeedbackBundleContent(content, { maxEntries: 1, maxChars: 500 });

    expect(bundle).toContain("new lesson about anchors");
    expect(bundle).not.toContain("old lesson");
    expect(bundle).toContain("Do not treat this file as a source of new product requirements");
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

describe("recoverClusterRunFromRunDir", () => {
  test("hydrates a finished retry run from run-result.json and raw output", async () => {
    const files = new Map([
      ["/tmp/run-2/run-result.json", JSON.stringify({
        runId: "run-2",
        status: "succeeded",
        exitCode: 0,
        durationMs: 12,
        clusterId: "cluster-fe-1",
        claudeSessionId: "sid-2",
        stdoutPath: "/tmp/run-2/claude.stdout.log",
        stderrPath: "/tmp/run-2/claude.stderr.log",
        rawResultPath: "/tmp/run-2/split-result.raw.json",
      })],
      ["/tmp/run-2/split-result.raw.json", JSON.stringify({
        tasks: [
          {
            id: "task-1",
            title: "Recovered task",
            description: "Recovered from background retry.",
            role: "frontend",
            executionStatus: "executable",
            missingPrerequisites: [],
            subtasks: ["Recover"],
            dod: ["Recovered"],
            dependencies: [],
            sourceRequirementIds: ["req-functional-1"],
            taskAnchors: {
              from: 0,
              to: 18,
              textHash: "aaaaaaaaaaaaaaaa",
              contextBefore: "Build selected UI",
              contextAfter: "Build selected UI",
            },
          },
        ],
      })],
    ]);
    mock.module("../materializePrdSnapshot", () => ({
      readSnapshotFile: mock(async (path: string) => {
        const content = files.get(path);
        if (content == null) throw new Error(`missing ${path}`);
        return content;
      }),
    }));

    const result = await recoverClusterRunFromRunDir({
      runId: "run-2",
      runDir: "/tmp/run-2",
      prd: makePrd(),
      cluster,
      requirementsIndex: makeRequirementsIndex(),
      context: null,
    });

    expect(result.errors).toEqual([]);
    expect(result.raw.claudeSessionId).toBe("sid-2");
    expect(result.normalized?.splitTasks[0]?.title).toBe("Recovered task");
  });

  test("keeps cancelled retry evidence even when raw output is missing", async () => {
    mock.module("../materializePrdSnapshot", () => ({
      readSnapshotFile: mock(async (path: string) => {
        if (path === "/tmp/run-cancelled/run-result.json") {
          return JSON.stringify({
            runId: "run-cancelled",
            status: "cancelled",
            exitCode: 130,
            durationMs: 0,
            clusterId: "cluster-fe-1",
            stdoutPath: "/tmp/run-cancelled/claude.stdout.log",
            stderrPath: "/tmp/run-cancelled/claude.stderr.log",
            error: "PRD split run cancelled by user",
          });
        }
        throw new Error(`missing ${path}`);
      }),
    }));

    const result = await recoverClusterRunFromRunDir({
      runId: "run-cancelled",
      runDir: "/tmp/run-cancelled",
      prd: makePrd(),
      cluster,
      requirementsIndex: makeRequirementsIndex(),
      context: null,
    });

    expect(result.normalized).toBeNull();
    expect(result.raw.exitCode).toBe(130);
    expect(result.raw.rawResultPath).toBe("/tmp/run-cancelled/split-result.raw.json");
    expect(result.errors.join("\n")).toContain("PRD split run cancelled by user");
  });
});

describe("cancelClusterRun", () => {
  test("wraps the cancel Tauri command", async () => {
    const output = {
      runId: "run-1",
      runDir: "/tmp/run-1",
      clusterId: "cluster-fe-1",
      signalledRunningProcess: true,
      wroteRunResult: true,
      alreadyFinished: false,
    };
    const invoke = mock(async () => output);
    mock.module("@tauri-apps/api/core", () => ({ invoke }));

    const result = await cancelClusterRun({ runId: "run-1" });

    expect(result).toEqual(output);
    expect(invoke).toHaveBeenCalledWith("prd_split_cancel_run", {
      input: {
        runId: "run-1",
      },
    });
  });
});

function makePrd(): PrdDocument {
  return {
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
}

function makeRequirementsIndex(): RequirementsIndexV2 {
  return {
    schemaVersion: 2,
    version: "v1",
    requirements: [
      { id: "req-functional-1", content: "Build selected UI", bodyHash: "aaaaaaaaaaaaaaaa" },
      { id: "req-functional-2", content: "Build unrelated backend", bodyHash: "bbbbbbbbbbbbbbbb" },
    ],
  };
}

function findDispatchClusterCall(
  invoke: { mock: { calls: unknown[][] } },
): [string, { input: Record<string, unknown> }] | undefined {
  return invoke.mock.calls.find((call): call is [string, { input: Record<string, unknown> }] => (
    call[0] === "prd_split_dispatch_cluster"
    && Boolean(call[1])
    && typeof call[1] === "object"
    && "input" in call[1]
  ));
}
