import { describe, expect, test } from "bun:test";
import type { ClusterPlanItem } from "./clusterPlanner";
import {
  buildPrdSplitWorkflowArtifacts,
  buildPrdSplitWorkflowTracePreview,
} from "./workflowGraphFromSplit";

function cluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "cluster-frontend-1",
    title: "Frontend",
    primaryRepositoryId: 7,
    repositoryIds: [7],
    requirementIds: ["req-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

describe("buildPrdSplitWorkflowArtifacts", () => {
  test("creates a draftable workflow graph from materialized split tasks", () => {
    const result = buildPrdSplitWorkflowArtifacts({
      projectId: "project-1",
      projectName: "Wise",
      projectRootPath: "/work/wise",
      clusters: [
        {
          cluster: cluster(),
          parentTaskName: "05-14-frontend",
          childTasks: [
            {
              sourceTaskId: "task-1",
              taskName: "05-14-add-login",
              taskPath: "/work/wise/.trellis/tasks/05-14-frontend/05-14-add-login",
            },
          ],
          tasks: [
            {
              sourceTaskId: "task-1",
              title: "Add login",
              role: "frontend",
              dependencies: [],
              sourceRequirementIds: ["req-1"],
              sourceRefs: ["src/auth.ts:42"],
              taskAnchors: {
                from: 10,
                to: 26,
                textHash: "anchor123",
                contextBefore: "before",
                contextAfter: "after",
              },
            },
          ],
        },
      ],
    });

    expect(result.workflowId).toBe("prd-split-project-1-05-14-frontend");
    expect(result.name).toBe("PRD Split · Wise");
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["start", "task-task-1", "end"]);
    expect(result.graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["start", "task-task-1"],
      ["task-task-1", "end"],
    ]);
    const taskNode = result.graph.nodes.find((node) => node.id === "task-task-1");
    expect(taskNode?.type).toBe("task");
    expect(taskNode?.data.employeePrompt).toContain(
      "Active task: /work/wise/.trellis/tasks/05-14-frontend/05-14-add-login",
    );
    expect(taskNode?.data.sourceRequirementIds).toEqual(["req-1"]);
    expect(taskNode?.data.taskTrace).toMatchObject({
      taskId: "task-1",
      taskName: "05-14-add-login",
      taskPath: "/work/wise/.trellis/tasks/05-14-frontend/05-14-add-login",
      sourceRequirementIds: ["req-1"],
      parallelGroupId: "parallel-group-1",
    });
    expect(taskNode?.data.prdAnchor).toMatchObject({ from: 10, to: 26, textHash: "anchor123" });
    expect(taskNode?.data.codeAnchors).toEqual([{ raw: "src/auth.ts:42", filePath: "src/auth.ts", line: 42 }]);
    expect(result.graph.nodes[0].data.requirementTaskIndex).toEqual({ "req-1": ["task-1"] });
    expect(result.graph.nodes[0].data.parallelGroups).toEqual([{ id: "parallel-group-1", taskIds: ["task-1"] }]);
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].assignees).toEqual([]);
  });

  test("uses task dependencies as workflow graph edges and parallel groups", () => {
    const result = buildPrdSplitWorkflowArtifacts({
      projectId: "Project 中文",
      projectName: "Project 中文",
      projectRootPath: "/work/project",
      requirementsIndex: {
        schemaVersion: 2,
        version: "v1",
        requirements: [
          { id: "req-1", content: "A requirement", bodyHash: "hash-a" },
          { id: "req-2", content: "B requirement", bodyHash: "hash-b" },
          { id: "req-3", content: "C requirement", bodyHash: "hash-c" },
        ],
      },
      clusters: [
        {
          cluster: cluster(),
          parentTaskName: "05-14-parent",
          childTasks: [
            {
              sourceTaskId: "task-a",
              taskName: "05-14-task-a",
              taskPath: "/work/project/.trellis/tasks/05-14-parent/05-14-task-a",
            },
            {
              sourceTaskId: "task-b",
              taskName: "05-14-task-b",
              taskPath: "/work/project/.trellis/tasks/05-14-parent/05-14-task-b",
            },
            {
              sourceTaskId: "task-c",
              taskName: "05-14-task-c",
              taskPath: "/work/project/.trellis/tasks/05-14-parent/05-14-task-c",
            },
          ],
          tasks: [
            {
              sourceTaskId: "task-a",
              title: "A",
              role: "backend",
              dependencies: [],
              sourceRequirementIds: ["req-1"],
            },
            {
              sourceTaskId: "task-b",
              title: "B",
              role: "frontend",
              dependencies: ["task-a"],
              sourceRequirementIds: ["req-2"],
            },
            {
              sourceTaskId: "task-c",
              title: "C",
              role: "frontend",
              dependencies: ["task-a"],
              sourceRequirementIds: ["req-2", "req-3"],
            },
          ],
        },
      ],
    });

    expect(result.workflowId).toBe("prd-split-project-05-14-parent");
    expect(result.graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["start", "task-task-a"],
      ["task-task-a", "task-task-b"],
      ["task-task-a", "task-task-c"],
      ["task-task-b", "end"],
      ["task-task-c", "end"],
    ]);
    expect(result.graph.nodes[0].data.parallelGroups).toEqual([
      { id: "parallel-group-1", taskIds: ["task-a"] },
      { id: "parallel-group-2", taskIds: ["task-b", "task-c"] },
    ]);
    expect(result.graph.nodes[0].data.requirementTrace).toEqual([
      {
        id: "req-1",
        content: "A requirement",
        bodyHash: "hash-a",
        taskIds: ["task-a"],
        completedTaskIds: [],
        totalTasks: 1,
        completedTasks: 0,
      },
      {
        id: "req-2",
        content: "B requirement",
        bodyHash: "hash-b",
        taskIds: ["task-b", "task-c"],
        completedTaskIds: [],
        totalTasks: 2,
        completedTasks: 0,
      },
      {
        id: "req-3",
        content: "C requirement",
        bodyHash: "hash-c",
        taskIds: ["task-c"],
        completedTaskIds: [],
        totalTasks: 1,
        completedTasks: 0,
      },
    ]);
    expect(result.graph.nodes.find((node) => node.id === "task-task-b")?.data.taskPath).toBe("/work/project/.trellis/tasks/05-14-parent/05-14-task-b");
    expect(result.graph.nodes.find((node) => node.id === "task-task-b")?.data.parentTaskName).toBe("05-14-parent");
    expect(result.graph.nodes.find((node) => node.id === "task-task-c")?.data.parallelGroupId).toBe("parallel-group-2");

    const preview = buildPrdSplitWorkflowTracePreview(result.graph);
    expect(preview.parallelGroups[1]).toEqual({ id: "parallel-group-2", taskIds: ["task-b", "task-c"] });
    expect(preview.requirements.find((item) => item.id === "req-2")?.taskIds).toEqual(["task-b", "task-c"]);
    expect(preview.tasks.find((item) => item.sourceTaskId === "task-c")?.sourceRequirementIds).toEqual(["req-2", "req-3"]);
  });

  test("creates a valid empty graph when all clusters have no executable tasks", () => {
    const result = buildPrdSplitWorkflowArtifacts({
      projectId: "p",
      projectName: "P",
      projectRootPath: "/p",
      clusters: [
        {
          cluster: cluster(),
          parentTaskName: "parent",
          childTasks: [],
          tasks: [],
        },
      ],
    });

    expect(result.graph.nodes.map((node) => node.id)).toEqual(["start", "end"]);
    expect(result.graph.edges).toEqual([{ id: "edge-start-end", source: "start", target: "end" }]);
    expect(result.stages).toEqual([]);
  });
});
