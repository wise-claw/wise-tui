import { describe, expect, test } from "bun:test";
import type { TrellisRequirementWorkspaceSnapshot } from "../services/trellisTaskBridge";
import { countUnsplitRequirementsInSnapshot } from "./requirementWorkspaceUnsplit";

describe("countUnsplitRequirementsInSnapshot", () => {
  test("counts requirements without mapped child tasks", () => {
    const snapshot: TrellisRequirementWorkspaceSnapshot = {
      sources: [],
      prds: [
        {
          taskId: "05-01-parent",
          dir: ".trellis/tasks/05-01-parent",
          title: "PRD",
          status: "planning",
          archived: false,
          rootPath: "/tmp/project",
          sourceKind: "project",
          repositoryId: null,
          clusterId: "cluster-1",
          requirementsIndexJson: JSON.stringify({
            requirements: [{ id: "REQ-1", content: "A" }, { id: "REQ-2", content: "B" }],
          }),
          prdMarkdown: "# PRD",
          childTaskIds: [],
        },
      ],
      tasks: [],
    };

    expect(countUnsplitRequirementsInSnapshot(snapshot)).toBe(2);
  });

  test("ignores requirements already covered by child task sourceRequirementIds", () => {
    const snapshot: TrellisRequirementWorkspaceSnapshot = {
      sources: [],
      prds: [
        {
          taskId: "05-01-parent",
          dir: ".trellis/tasks/05-01-parent",
          title: "PRD",
          status: "planning",
          archived: false,
          rootPath: "/tmp/project",
          sourceKind: "project",
          repositoryId: null,
          clusterId: "cluster-1",
          requirementsIndexJson: JSON.stringify({
            requirements: [{ id: "REQ-1", content: "A" }, { id: "REQ-2", content: "B" }],
          }),
          prdMarkdown: "# PRD",
          childTaskIds: ["05-01-child"],
        },
      ],
      tasks: [
        {
          taskId: "05-01-child",
          dir: ".trellis/tasks/05-01-child",
          title: "Child",
          status: "planning",
          archived: false,
          hasPrd: false,
          hasResearch: false,
          rootPath: "/tmp/project",
          sourceKind: "project",
          repositoryId: null,
          clusterId: "cluster-1",
          sourceRequirementIds: ["REQ-1"],
          parent: "05-01-parent",
        },
      ],
    };

    expect(countUnsplitRequirementsInSnapshot(snapshot)).toBe(1);
  });

  test("workspace scope counts only project-root PRDs", () => {
    const snapshot: TrellisRequirementWorkspaceSnapshot = {
      sources: [],
      prds: [
        {
          taskId: "ws-parent",
          dir: ".trellis/tasks/ws-parent",
          title: "Workspace PRD",
          status: "planning",
          archived: false,
          rootPath: "/tmp/project",
          sourceKind: "project",
          repositoryId: null,
          clusterId: null,
          requirementsIndexJson: JSON.stringify({
            requirements: [{ id: "REQ-WS", content: "Workspace" }],
          }),
          prdMarkdown: "# PRD",
          childTaskIds: [],
        },
        {
          taskId: "repo-parent",
          dir: ".trellis/tasks/repo-parent",
          title: "Repo PRD",
          status: "planning",
          archived: false,
          rootPath: "/tmp/repo",
          sourceKind: "projectRepository",
          repositoryId: 7,
          clusterId: null,
          requirementsIndexJson: JSON.stringify({
            requirements: [{ id: "REQ-REPO", content: "Repo" }],
          }),
          prdMarkdown: "# PRD",
          childTaskIds: [],
        },
      ],
      tasks: [],
    };

    expect(countUnsplitRequirementsInSnapshot(snapshot, { kind: "workspace" })).toBe(1);
    expect(countUnsplitRequirementsInSnapshot(snapshot, { kind: "repository", repositoryId: 7 })).toBe(1);
    expect(countUnsplitRequirementsInSnapshot(snapshot, { kind: "repository", repositoryId: 9 })).toBe(0);
  });
});
