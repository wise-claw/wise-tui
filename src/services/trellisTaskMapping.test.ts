import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowStageOutcomeCriterion, WorkflowTaskItem } from "../types";
import {
  criteriaToSpecMarkdownSection,
  mergeSpecMarkdownWithStageCriteria,
  parseAcceptanceCriteriaSection,
  trellisTaskToWorkflowStatus,
  workflowTaskToTrellisDraft,
} from "./trellisTaskMapping";

function makeTask(overrides: Partial<WorkflowTaskItem> = {}): WorkflowTaskItem {
  return {
    id: "task-1",
    title: "Add foo",
    content: "Body explaining foo.",
    creator: "xuning",
    workflowId: "wf-1",
    currentStageIndex: 0,
    status: "in_progress",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: "node-implement",
        type: "task",
        position: { x: 0, y: 0 },
        data: {
          label: "implement",
          stageSuccessCriteria: [
            { name: "tests pass", requirement: "bun test green" },
            { name: "docs", requirement: "spec updated" },
          ],
        },
      },
    ],
    edges: [],
  };
}

describe("workflowTaskToTrellisDraft", () => {
  test("renders title body and criteria as markdown", () => {
    const draft = workflowTaskToTrellisDraft(makeTask(), makeGraph());
    expect(draft.prdMarkdown).toContain("# Add foo");
    expect(draft.prdMarkdown).toContain("Body explaining foo.");
    expect(draft.prdMarkdown).toContain("## Acceptance Criteria");
    expect(draft.prdMarkdown).toContain("- **tests pass** — bun test green");
    expect(draft.prdMarkdown).toContain("- **docs** — spec updated");
    expect(draft.statusForTrellis).toBe("in_progress");
  });

  test("omits criteria section when graph is missing", () => {
    const draft = workflowTaskToTrellisDraft(makeTask());
    expect(draft.prdMarkdown).not.toContain("Acceptance Criteria");
  });

  test("omits criteria section when graph has only start/end nodes", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "start" } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { label: "end" } },
      ],
      edges: [],
    };
    const draft = workflowTaskToTrellisDraft(makeTask(), graph);
    expect(draft.prdMarkdown).not.toContain("Acceptance Criteria");
  });

  test("falls back to task id when title is empty", () => {
    const draft = workflowTaskToTrellisDraft(makeTask({ title: "" }));
    expect(draft.prdMarkdown.startsWith("# task-1")).toBe(true);
  });

  test("skips body section when task content is whitespace", () => {
    const draft = workflowTaskToTrellisDraft(makeTask({ content: "   \n  " }));
    expect(draft.prdMarkdown.trim()).toBe("# Add foo");
  });

  test("maps each workflow status to a trellis equivalent", () => {
    expect(workflowTaskToTrellisDraft(makeTask({ status: "completed" })).statusForTrellis).toBe(
      "completed",
    );
    expect(workflowTaskToTrellisDraft(makeTask({ status: "rejected" })).statusForTrellis).toBe(
      "rejected",
    );
    expect(workflowTaskToTrellisDraft(makeTask({ status: "archived" })).statusForTrellis).toBe(
      "archived",
    );
  });

  test("collapses 3+ blank lines in rendered markdown", () => {
    const draft = workflowTaskToTrellisDraft(
      makeTask({ content: "First line.\n\n\n\nSecond line." }),
    );
    expect(draft.prdMarkdown).not.toContain("\n\n\n");
  });
});

describe("trellisTaskToWorkflowStatus", () => {
  test("maps known statuses", () => {
    expect(trellisTaskToWorkflowStatus("in_progress")).toBe("in_progress");
    expect(trellisTaskToWorkflowStatus("completed")).toBe("completed");
    expect(trellisTaskToWorkflowStatus("rejected")).toBe("rejected");
    expect(trellisTaskToWorkflowStatus("archived")).toBe("archived");
    expect(trellisTaskToWorkflowStatus("planning")).toBe("in_progress");
  });

  test("returns null for unknown statuses", () => {
    expect(trellisTaskToWorkflowStatus("foo")).toBe(null);
    expect(trellisTaskToWorkflowStatus("")).toBe(null);
  });
});

function criteriaFixture(): WorkflowStageOutcomeCriterion[] {
  return [
    { name: "tests pass", requirement: "bun test green" },
    { name: "docs", requirement: "spec updated" },
  ];
}

describe("criteriaToSpecMarkdownSection", () => {
  test("renders marker-fenced block with header and list", () => {
    const block = criteriaToSpecMarkdownSection("frontend", criteriaFixture());
    expect(block).toContain('<!-- wise:stage-criteria area="frontend" begin -->');
    expect(block).toContain('<!-- wise:stage-criteria area="frontend" end -->');
    expect(block).toContain("## Wise Stage Criteria — frontend");
    expect(block).toContain("- **tests pass** — bun test green");
    expect(block).toContain("- **docs** — spec updated");
  });

  test("emits (no entries) when criteria is empty", () => {
    const block = criteriaToSpecMarkdownSection("tauri", []);
    expect(block).toContain("(no entries)");
    expect(block).toContain('area="tauri"');
  });

  test("substitutes placeholders for empty fields", () => {
    const block = criteriaToSpecMarkdownSection("g", [{ name: "", requirement: "" }]);
    expect(block).toContain("- **(unnamed)** — (no requirement)");
  });
});

describe("parseAcceptanceCriteriaSection", () => {
  test("recognizes strict em-dash bullets", () => {
    const md = [
      "# Title",
      "",
      "## Acceptance Criteria",
      "",
      "- **alpha** — A says alpha",
      "- **beta** — B says beta",
      "",
      "## Next Section",
      "- **ignored** — should not parse",
    ].join("\n");
    const result = parseAcceptanceCriteriaSection(md);
    expect(result).toEqual([
      { name: "alpha", requirement: "A says alpha" },
      { name: "beta", requirement: "B says beta" },
    ]);
  });

  test("recognizes loose colon bullets when strict is absent", () => {
    const md = [
      "## Acceptance Criteria",
      "- tests: must be green",
      "- docs: spec must mention this change",
    ].join("\n");
    const result = parseAcceptanceCriteriaSection(md);
    expect(result).toEqual([
      { name: "tests", requirement: "must be green" },
      { name: "docs", requirement: "spec must mention this change" },
    ]);
  });

  test("returns [] when section is absent", () => {
    expect(parseAcceptanceCriteriaSection("# Plain")).toEqual([]);
    expect(parseAcceptanceCriteriaSection("")).toEqual([]);
  });

  test("stops at next ## heading", () => {
    const md = [
      "## Acceptance Criteria",
      "- **x** — y",
      "## Out of Scope",
      "- **z** — w",
    ].join("\n");
    expect(parseAcceptanceCriteriaSection(md)).toEqual([{ name: "x", requirement: "y" }]);
  });
});

describe("mergeSpecMarkdownWithStageCriteria", () => {
  test("replaces an existing block in-place", () => {
    const initial = mergeSpecMarkdownWithStageCriteria(
      "# Frontend Spec\n\nbody.\n",
      "frontend",
      criteriaFixture(),
    );
    const replaced = mergeSpecMarkdownWithStageCriteria(initial, "frontend", [
      { name: "only one", requirement: "stay" },
    ]);
    expect(replaced).toContain("- **only one** — stay");
    expect(replaced).not.toContain("- **tests pass** — bun test green");
    const beginCount = (replaced.match(/area="frontend" begin -->/g) ?? []).length;
    expect(beginCount).toBe(1);
  });

  test("appends a block when none exists, preserving prior content", () => {
    const merged = mergeSpecMarkdownWithStageCriteria(
      "# Tauri Spec\n\nbody.",
      "tauri",
      criteriaFixture(),
    );
    expect(merged.startsWith("# Tauri Spec\n\nbody.")).toBe(true);
    expect(merged).toContain('<!-- wise:stage-criteria area="tauri" begin -->');
    expect(merged.endsWith("\n")).toBe(true);
  });

  test("keeps two area blocks independent", () => {
    const after = mergeSpecMarkdownWithStageCriteria(
      mergeSpecMarkdownWithStageCriteria("", "frontend", criteriaFixture()),
      "tauri",
      criteriaFixture(),
    );
    expect(after).toContain('area="frontend" begin');
    expect(after).toContain('area="tauri" begin');
  });

  test("starts a fresh document when input is empty", () => {
    const merged = mergeSpecMarkdownWithStageCriteria("", "guides", criteriaFixture());
    expect(merged.startsWith('<!-- wise:stage-criteria area="guides" begin -->')).toBe(true);
  });
});
