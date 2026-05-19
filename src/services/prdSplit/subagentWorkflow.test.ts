import { describe, expect, mock, test } from "bun:test";
import type { PrdDocument, ProjectItem, Repository, TaskSplitContext } from "../../types";
import type { DispatchClusterRawOutput } from "./splitterDispatch";

const invoke = mock(async (command: string, payload?: unknown) => {
  if (command === "prd_split_create_parent_task") {
    const clusterId = String((payload as { input?: { clusterId?: unknown } }).input?.clusterId ?? "cluster");
    return {
      parentTaskName: `05-18-${clusterId}`,
      parentTaskPath: `.trellis/tasks/05-18-${clusterId}`,
    };
  }
  if (command !== "prd_split_dispatch_cluster") {
    throw new Error(`unexpected command: ${command}`);
  }
  const input = (payload as {
    input?: {
      clusterId?: string;
    };
  }).input;
  const clusterId = input?.clusterId ?? "cluster-frontend-1";
  const requirementId = "req-functional-1";
  const requirementText = clusterId.includes("backend")
    ? "backend API"
    : "web login";
  const tasks = [
    {
      id: "task-1",
      title: `Task for ${requirementId}`,
      scope: `Implement ${requirementId}`,
      type: "feature",
      description: `Implement ${requirementId}`,
      role: clusterId.includes("backend") ? "backend" : "frontend",
      status: "not_executable",
      executionStatus: "not_executable",
      depends_on: [],
      deliverables: ["Build"],
      acceptance_criteria: ["Done"],
      test_plan: ["Run focused tests"],
      missing_prerequisites: ["Needs review"],
      missingPrerequisites: ["Needs review"],
      risk_notes: [],
      subtasks: ["Build"],
      dod: ["Done"],
      dependencies: [],
      sourceRequirementIds: [requirementId],
      taskAnchors: {
        from: 0,
        to: 20,
        textHash: "hash",
        contextBefore: requirementText,
        contextAfter: requirementText,
      },
      clusterId,
    },
    ...(clusterId.includes("backend")
      ? [{
        id: "task-2",
        title: "Backend contract follow-up",
        scope: "Wire backend contract",
        type: "feature",
        description: "Wire backend contract",
        role: "backend",
        status: "not_executable",
        executionStatus: "not_executable",
        depends_on: ["task-1"],
        deliverables: ["Build"],
        acceptance_criteria: ["Done"],
        test_plan: ["Run focused tests"],
        missing_prerequisites: ["Needs review"],
        missingPrerequisites: ["Needs review"],
        risk_notes: [],
        subtasks: ["Build"],
        dod: ["Done"],
        dependencies: ["task-1"],
        sourceRequirementIds: [requirementId],
        taskAnchors: {
          from: 0,
          to: 20,
          textHash: "hash-2",
          contextBefore: requirementText,
          contextAfter: requirementText,
        },
        clusterId,
      }]
      : []),
  ];
  const raw: DispatchClusterRawOutput = {
    runId: `run-${clusterId}`,
    runDir: `/tmp/run-${clusterId}`,
    exitCode: 0,
    durationMs: 1,
    stdoutPath: `/tmp/run-${clusterId}/claude.stdout.log`,
    stderrPath: `/tmp/run-${clusterId}/claude.stderr.log`,
    rawResultPath: `/tmp/run-${clusterId}/split-result.raw.json`,
    stdoutTruncatedPreview: "",
    rawOutput: {
      repo_type: clusterId.includes("backend") ? "backend" : "frontend",
      context_summary: {
        tech_stack: [],
        key_dirs: [],
        constraints: [],
        existing_capabilities: [],
        unknowns: [],
      },
      tasks,
      execution_order: tasks.map((task) => task.id),
      global_missing_prerequisites: [],
      assumptions: [],
      version: 1,
      taskRequirementLinks: [
        ...tasks.map((task) => ({ taskId: task.id, requirementIds: [requirementId] })),
      ],
    },
    claudeSessionId: "sid-1",
  };
  return raw;
});

mock.module("@tauri-apps/api/core", () => ({
  invoke,
}));

const { runPrdSplitSubagentWorkflow } = await import("./subagentWorkflow");

const prd: PrdDocument = {
  title: "Feature",
  sourceType: "manual",
  sourceRef: null,
  background: [],
  goals: [],
  scenarios: [],
  functional: ["Build web login UI"],
  nonFunctional: [],
  acceptance: [],
};

const project: ProjectItem = {
  id: "p1",
  name: "Wise",
  repositoryIds: [1],
  createdAt: 0,
  updatedAt: 0,
  rootPath: "/workspace",
  sddMode: "wise_trellis",
};

const repositories: Repository[] = [
  {
    id: 1,
    name: "web",
    path: "/repos/web",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
  },
];

const backendRepository: Repository = {
  id: 2,
  name: "api",
  path: "/repos/api",
  repositoryType: "backend",
  createdAt: "",
  updatedAt: "",
};

describe("runPrdSplitSubagentWorkflow", () => {
  test("starts clean", () => {
    invoke.mockClear();
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  test("plans clusters and dispatches trellis-splitter instead of one-shot split command", async () => {
    invoke.mockClear();
    const events: string[] = [];
    const result = await runPrdSplitSubagentWorkflow({
      project,
      repositories,
      prd,
      prdMarkdown: "# Feature\n\n- Build web login UI",
      context: {
        mode: "project",
        projectId: project.id,
        projectName: project.name,
        repositoryId: 1,
        repositoryName: "web",
        repositoryPath: "/repos/web",
        repositoryType: "frontend",
      },
      onEvent: (event) => events.push(event.type),
    });

    const commands = invoke.mock.calls.map((call) => call[0]);
    expect(commands).toEqual(["prd_split_create_parent_task", "prd_split_dispatch_cluster"]);
    expect(commands).not.toContain("run_prd_split_claude");
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({
      input: {
        projectRootPath: "/workspace",
        executionRootPath: "/repos/web",
        parentTaskPath: ".trellis/tasks/05-18-cluster-frontend-1",
        clusterId: "cluster-frontend-1",
      },
    });
    expect(result.result.splitTasks).toHaveLength(1);
    expect(result.result.splitTasks[0]?.id).toBe("task-1");
    expect(result.result.splitTasks[0]?.sourceRequirementIds).toEqual(["req-functional-1"]);
    expect(events).toEqual(["plan", "cluster-start", "parent-created", "cluster-complete"]);
  });

  test("namespaces task ids when merging multiple cluster splitter outputs", async () => {
    invoke.mockClear();
    const result = await runPrdSplitSubagentWorkflow({
      project: { ...project, repositoryIds: [1, 2] },
      repositories: [...repositories, backendRepository],
      prd: {
        ...prd,
        functional: ["Build frontend web login UI", "Build backend API login endpoint"],
      },
      prdMarkdown: "# Feature\n\n- Build frontend web login UI\n- Build backend API login endpoint",
      context: {
        mode: "project",
        projectId: project.id,
        projectName: project.name,
      },
    });

    expect(result.result.splitTasks.map((task) => task.id)).toEqual([
      "cluster-frontend-1-task-1",
      "cluster-backend-2-task-1",
      "cluster-backend-2-task-2",
    ]);
    expect(result.result.splitTasks[0]?.dependencies).toEqual([]);
    expect(result.result.splitTasks[1]?.dependencies).toEqual([]);
    expect(result.result.splitTasks[2]?.dependencies).toEqual(["cluster-backend-2-task-1"]);
    expect(result.result.claudeSplitMapping?.taskRequirementLinks.map((link) => link.taskId)).toEqual([
      "cluster-frontend-1-task-1",
      "cluster-backend-2-task-1",
      "cluster-backend-2-task-2",
    ]);
    expect(Object.keys(result.result.taskAnchorDescriptors ?? {})).toEqual([
      "cluster-frontend-1-task-1",
      "cluster-backend-2-task-1",
      "cluster-backend-2-task-2",
    ]);
    expect(Object.keys(result.result.taskAnchorTexts ?? {})).toEqual([
      "cluster-frontend-1-task-1",
      "cluster-backend-2-task-1",
      "cluster-backend-2-task-2",
    ]);
  });

  test("requires a workspace rootPath and at least one associated repository", async () => {
    await expect(runPrdSplitSubagentWorkflow({
      project: { ...project, rootPath: "" },
      repositories,
      prd,
      prdMarkdown: "# Feature",
      context: { mode: "project", projectId: project.id },
    })).rejects.toThrow("rootPath");

    await expect(runPrdSplitSubagentWorkflow({
      project: { ...project, repositoryIds: [] },
      repositories,
      prd,
      prdMarkdown: "# Feature",
      context: { mode: "project", projectId: project.id },
    })).rejects.toThrow("尚未关联仓库");
  });
});
