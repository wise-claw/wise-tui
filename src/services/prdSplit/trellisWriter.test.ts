import { describe, expect, test } from "bun:test";
import type {
  PrdDocument,
  SplitResult,
  TaskAnchorDescriptor,
  TaskItem,
} from "../../types";
import {
  buildMaterializePayload,
  deriveSlug,
  renderChildPrd,
  renderParentPrd,
  type ClusterRef,
  type WriteClusterTasksInput,
} from "./trellisWriter";

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const anchor: TaskAnchorDescriptor = {
    from: 100,
    to: 250,
    textHash: "abc12345def67890",
    contextBefore: "上文……",
    contextAfter: "下文……",
  };
  return {
    id: "task-1",
    title: "Add login flow",
    description: "Implement user login UI + token storage.",
    role: "frontend",
    size: "M",
    estimateDays: 2,
    dependencies: ["task-2"],
    sourceRefs: [],
    sourceRequirementIds: ["req-functional-1", "req-acceptance-3"],
    subtasks: ["Wire form", "Persist token"],
    dod: ["登录可成功", "刷新仍登录"],
    taskAnchors: anchor,
    executionStatus: "executable",
    executionStatusManual: false,
    flowStatus: "todo",
    ...overrides,
  };
}

function makePrd(): PrdDocument {
  return {
    title: "Some PRD",
    sourceType: "markdown",
    sourceRef: null,
    background: [],
    goals: [],
    scenarios: [],
    functional: ["Functional 1"],
    nonFunctional: [],
    acceptance: ["Acceptance 1"],
  };
}

const cluster: ClusterRef = {
  id: "cluster-fe-01",
  title: "Frontend - login",
  primaryRepositoryId: 7,
  repositoryIds: [7],
};

describe("deriveSlug", () => {
  test("normalizes title to ASCII slug", () => {
    expect(deriveSlug("Add login flow", "task-1")).toBe("add-login-flow");
  });

  test("falls back to id when title is non-ASCII only", () => {
    expect(deriveSlug("登录流程", "task-2")).toBe("task-2");
  });

  test("falls back to literal 'task' when both empty", () => {
    expect(deriveSlug("...", "...")).toBe("task");
  });

  test("collapses non-ASCII gaps but keeps adjacent ASCII", () => {
    expect(deriveSlug("Add 登录 flow", "task-3")).toBe("add-flow");
  });
});

describe("renderChildPrd", () => {
  test("emits cluster banner, requirements, subtasks, DoD, anchor", () => {
    const md = renderChildPrd(makeTask(), cluster);
    expect(md).toContain("# Add login flow");
    expect(md).toContain("cluster: `cluster-fe-01`");
    expect(md).toContain("repositoryId: `7`");
    expect(md).toContain("role: `frontend`");
    expect(md).toContain("- req-functional-1");
    expect(md).toContain("- req-acceptance-3");
    expect(md).toContain("- Wire form");
    expect(md).toContain("- [ ] 登录可成功");
    expect(md).toContain("textHash: `abc12345def67890`");
    expect(md).toContain("range: [100, 250]");
    expect(md).toContain("- task-2");
  });

  test("repositoryId 'null' when cluster has no primary repo", () => {
    const md = renderChildPrd(makeTask(), { ...cluster, primaryRepositoryId: null });
    expect(md).toContain("repositoryId: `null`");
  });

  test("omits Description section when description is blank", () => {
    const md = renderChildPrd(makeTask({ description: "   " }), cluster);
    expect(md).not.toContain("## Description");
  });

  test("omits Anchor section when no anchor", () => {
    const md = renderChildPrd(makeTask({ taskAnchors: undefined }), cluster);
    expect(md).not.toContain("## Anchor");
  });

  test("includes not_executable warning when planner flagged it", () => {
    const md = renderChildPrd(
      makeTask({ executionStatus: "not_executable" }),
      cluster,
    );
    expect(md).toContain("executionStatus: not_executable");
  });
});

describe("renderParentPrd", () => {
  test("prepends cluster banner comment", () => {
    const md = renderParentPrd("# PRD body\n\nsome text", cluster);
    expect(md.startsWith("<!-- cluster: ")).toBe(true);
    expect(md).toContain('"id":"cluster-fe-01"');
    expect(md).toContain("# PRD body");
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("buildMaterializePayload", () => {
  test("projects normalized split into child task payloads with cluster metadata", () => {
    const split: SplitResult = {
      source: makePrd(),
      context: null,
      splitTasks: [makeTask(), makeTask({ id: "task-2", title: "Persist token" })],
      executableTasks: [],
      criticalPath: [],
      parallelGroups: [],
      unmetPreconditions: [],
      claudeSplitMapping: {
        version: 1,
        taskRequirementLinks: [
          { taskId: "task-1", requirementIds: ["req-functional-1"] },
        ],
        capturedAtMs: 1700000000000,
      },
    };
    const input: WriteClusterTasksInput = {
      projectRootPath: "/tmp/proj",
      parentTaskName: "05-13-parent",
      cluster,
      normalized: split,
      prdSource: makePrd(),
    };
    const payload = buildMaterializePayload(input);

    expect(payload.projectRootPath).toBe("/tmp/proj");
    expect(payload.parentTaskName).toBe("05-13-parent");
    expect(payload.cluster.id).toBe("cluster-fe-01");
    expect(payload.childTasks).toHaveLength(2);
    expect(payload.childTasks[0].slug).toBe("add-login-flow");
    expect(payload.childTasks[0].repositoryId).toBe(7);
    expect(payload.childTasks[0].clusterId).toBe("cluster-fe-01");
    expect(payload.childTasks[0].role).toBe("frontend");
    expect(payload.childTasks[0].sourceRequirementIds).toEqual([
      "req-functional-1",
      "req-acceptance-3",
    ]);
    expect(payload.childTasks[0].taskAnchors?.textHash).toBe("abc12345def67890");
    expect(payload.childTasks[1].slug).toBe("persist-token");
    expect(payload.claudeSplitMapping?.taskRequirementLinks).toHaveLength(1);
  });

  test("claudeSplitMapping projects to null when absent", () => {
    const split: SplitResult = {
      source: makePrd(),
      context: null,
      splitTasks: [makeTask()],
      executableTasks: [],
      criticalPath: [],
      parallelGroups: [],
      unmetPreconditions: [],
    };
    const payload = buildMaterializePayload({
      projectRootPath: "/tmp/proj",
      parentTaskName: "05-13-parent",
      cluster,
      normalized: split,
      prdSource: makePrd(),
    });
    expect(payload.claudeSplitMapping).toBeNull();
  });
});
