import { describe, expect, it } from "bun:test";
import {
  isEmployeeRepositoryOwnerInScope,
  listRepositoryMainOwnerDisplayGaps,
  repositoryBasenamesWhereEmployeeIsConfiguredMainOwner,
  repositoryOwnerBasenamesInScope,
  repositoryOwnerBasenamesInScopeRelaxed,
  resolveMainOwnerEmployeeIdsForProjectRepositories,
  shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope,
  shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds,
  someEmployeeDisplaysMainOwnerForRepository,
} from "./projectPrdScopeDisplay";

describe("resolveMainOwnerEmployeeIdsForProjectRepositories", () => {
  it("only matches employees linked to that repository", () => {
    const repos = [
      { id: 1, mainOwnerAgentName: "executor" },
      { id: 2, mainOwnerAgentName: "reviewer" },
    ];
    const employees = [
      { id: "a", agentType: "executor", enabled: true, repositoryIds: [1] },
      { id: "b", agentType: "executor", enabled: true, repositoryIds: [99] },
      { id: "c", agentType: "reviewer", enabled: true, repositoryIds: [2] },
    ];
    const ids = resolveMainOwnerEmployeeIdsForProjectRepositories(repos, employees).sort();
    expect(ids).toEqual(["a", "c"]);
  });

  it("ignores disabled employees", () => {
    const repos = [{ id: 1, mainOwnerAgentName: "executor" }];
    const employees = [
      { id: "a", agentType: "executor", enabled: false, repositoryIds: [1] },
      { id: "b", agentType: "executor", enabled: true, repositoryIds: [1] },
    ];
    expect(resolveMainOwnerEmployeeIdsForProjectRepositories(repos, employees)).toEqual(["b"]);
  });
});

describe("repositoryBasenamesWhereEmployeeIsConfiguredMainOwner", () => {
  it("requires repositoryIds to include the repo id", () => {
    const projectRepos = [
      { id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" },
      { id: 2, path: "/p/b", name: "b", mainOwnerAgentName: "executor" },
    ];
    const names = repositoryBasenamesWhereEmployeeIsConfiguredMainOwner(projectRepos, {
      agentType: "executor",
      repositoryIds: [1],
    }).sort();
    expect(names).toEqual(["a"]);
  });
});

describe("listRepositoryMainOwnerDisplayGaps", () => {
  it("lists repos with main owner but no linked matching employee", () => {
    const repos = [
      { id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" },
      { id: 2, path: "/p/b", name: "b", mainOwnerAgentName: "x" },
    ];
    const employees = [
      { id: "a", agentType: "executor", enabled: true, repositoryIds: [1] },
    ];
    const gaps = listRepositoryMainOwnerDisplayGaps(repos, employees);
    expect(gaps).toEqual([{ repositoryId: 2, repoLabel: "b", agentName: "x" }]);
  });
});

describe("shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope", () => {
  it("hides employee only on scoped repos when each repo main owner matches agentType", () => {
    const byId = new Map<number, { mainOwnerAgentName: string | null }>([
      [1, { mainOwnerAgentName: "executor" }],
    ]);
    const employee = { repositoryIds: [1], agentType: "executor" };
    expect(shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope(employee, [1], byId)).toBe(true);
  });

  it("does not hide when a linked repo has no main owner configured", () => {
    const byId = new Map<number, { mainOwnerAgentName: string | null }>([
      [1, { mainOwnerAgentName: "executor" }],
      [2, { mainOwnerAgentName: null }],
    ]);
    const employee = { repositoryIds: [1, 2], agentType: "executor" };
    expect(shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope(employee, [1, 2], byId)).toBe(false);
  });

  it("does not hide when employee is linked to a repo outside the scope", () => {
    const byId = new Map<number, { mainOwnerAgentName: string | null }>([[1, { mainOwnerAgentName: "executor" }]]);
    const employee = { repositoryIds: [1, 99], agentType: "executor" };
    expect(shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope(employee, [1], byId)).toBe(false);
  });
});

describe("shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds", () => {
  it("hides when all linked repos are within the default id set", () => {
    expect(shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds({ repositoryIds: [1, 2] }, [1, 2, 3])).toBe(true);
  });

  it("does not hide when employee has a repo outside the set", () => {
    expect(shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds({ repositoryIds: [1, 99] }, [1, 2])).toBe(
      false,
    );
  });

  it("does not hide when no repositories linked", () => {
    expect(shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds({ repositoryIds: [] }, [1])).toBe(false);
  });
});

describe("repositoryOwnerBasenamesInScope / isEmployeeRepositoryOwnerInScope", () => {
  const repos = [
    { id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" },
    { id: 2, path: "/p/b", name: "b", mainOwnerAgentName: null },
  ];

  it("lists basenames only for scoped repos where employee is configured main owner", () => {
    expect(
      repositoryOwnerBasenamesInScope({ agentType: "executor", repositoryIds: [1] }, [1, 2], repos).sort(),
    ).toEqual(["a"]);
  });

  it("returns false when agent does not match main owner", () => {
    expect(isEmployeeRepositoryOwnerInScope({ agentType: "reviewer", repositoryIds: [1] }, [1], repos)).toBe(false);
  });

  it("returns false when employee is not linked to the repo", () => {
    expect(isEmployeeRepositoryOwnerInScope({ agentType: "executor", repositoryIds: [2] }, [1], repos)).toBe(false);
  });
});

describe("repositoryOwnerBasenamesInScopeRelaxed", () => {
  it("infers owner when repo has mainOwner but no employee links to that repo and only one enabled agent match", () => {
    const repos = [
      { id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" },
      { id: 2, path: "/p/b", name: "b", mainOwnerAgentName: "executor" },
    ];
    const employees = [
      { id: "only", agentType: "executor", enabled: true, repositoryIds: [] as number[] },
    ];
    expect(
      repositoryOwnerBasenamesInScopeRelaxed(employees[0], [1, 2], repos, employees).sort(),
    ).toEqual(["a", "b"]);
  });

  it("does not infer when multiple enabled employees share the agent name", () => {
    const repos = [{ id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" }];
    const employees = [
      { id: "a", agentType: "executor", enabled: true, repositoryIds: [] },
      { id: "b", agentType: "executor", enabled: true, repositoryIds: [] },
    ];
    expect(repositoryOwnerBasenamesInScopeRelaxed(employees[0], [1], repos, employees)).toEqual([]);
  });

  it("prefers explicit repository link over implicit when multiple share agent", () => {
    const repos = [{ id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" }];
    const employees = [
      { id: "linked", agentType: "executor", enabled: true, repositoryIds: [1] },
      { id: "other", agentType: "executor", enabled: true, repositoryIds: [] },
    ];
    expect(repositoryOwnerBasenamesInScopeRelaxed(employees[0], [1], repos, employees)).toEqual(["a"]);
    expect(repositoryOwnerBasenamesInScopeRelaxed(employees[1], [1], repos, employees)).toEqual([]);
  });
});

describe("someEmployeeDisplaysMainOwnerForRepository", () => {
  it("is true when relaxed owner display lists that repo basename", () => {
    const repos = [{ id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" }];
    const employees = [{ id: "only", agentType: "executor", enabled: true, repositoryIds: [] as number[] }];
    expect(someEmployeeDisplaysMainOwnerForRepository(1, [1], repos, employees)).toBe(true);
  });

  it("is false for gap repos when no employee matches display", () => {
    const repos = [{ id: 1, path: "/p/a", name: "a", mainOwnerAgentName: "executor" }];
    const employees = [
      { id: "a", agentType: "executor", enabled: true, repositoryIds: [] },
      { id: "b", agentType: "executor", enabled: true, repositoryIds: [] },
    ];
    expect(someEmployeeDisplaysMainOwnerForRepository(1, [1], repos, employees)).toBe(false);
  });
});
