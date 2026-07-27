import { describe, expect, test } from "bun:test";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  Repository,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../types";
import {
  collectFlatWorkspaceRepositories,
  filterDispatchTasksForRepository,
  filterEmployeeMonitorForRepository,
  filterTeamMonitorForRepository,
  formatWorkspaceSidebarRelativeTime,
  listWorkspaceSidebarHistorySessions,
  pickFirstWorkspaceSidebarHistorySession,
  sortDispatchTasksRunningFirst,
  sortEmployeeMonitorRunningFirst,
} from "./repositoryWorkspaceTree";

function makeRepo(id: number, name: string, path: string): Repository {
  return {
    id,
    name,
    path,
    repositoryType: "local",
    createdAt: 0,
  } as Repository;
}

function makeSession(
  id: string,
  repositoryPath: string,
  opts?: { createdAt?: number; content?: string },
): ClaudeSession {
  const createdAt = opts?.createdAt ?? 1_000;
  return {
    id,
    repositoryPath,
    repositoryName: "repo",
    createdAt,
    status: "idle",
    messages: opts?.content
      ? [{ id: `${id}-m`, role: "user", content: opts.content, timestamp: createdAt }]
      : [],
  } as ClaudeSession;
}

describe("collectFlatWorkspaceRepositories", () => {
  test("dedupes by id and sorts by basename when order empty", () => {
    const a = makeRepo(1, "zeta", "/work/zeta");
    const b = makeRepo(2, "alpha", "/work/alpha");
    const floatingDup = { ...a, name: "zeta-dup" };
    const flat = collectFlatWorkspaceRepositories([a, b], [floatingDup]);
    expect(flat.map((r) => r.id)).toEqual([2, 1]);
  });

  test("applies custom workspace order", () => {
    const a = makeRepo(1, "zeta", "/work/zeta");
    const b = makeRepo(2, "alpha", "/work/alpha");
    const flat = collectFlatWorkspaceRepositories([a, b], [], [1, 2]);
    expect(flat.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("listWorkspaceSidebarHistorySessions", () => {
  test("filters by repository path and sorts newest first", () => {
    const sessions = [
      makeSession("old", "/work/a", { createdAt: 100, content: "old" }),
      makeSession("new", "/work/a", { createdAt: 200, content: "new" }),
      makeSession("other", "/work/b", { createdAt: 300, content: "other" }),
    ];
    const listed = listWorkspaceSidebarHistorySessions(sessions, "/work/a");
    expect(listed.map((s) => s.id)).toEqual(["new", "old"]);
  });

  test("pickFirstWorkspaceSidebarHistorySession returns list head", () => {
    const sessions = [
      makeSession("old", "/work/a", { createdAt: 100, content: "old" }),
      makeSession("new", "/work/a", { createdAt: 200 }),
    ];
    expect(pickFirstWorkspaceSidebarHistorySession(sessions, "/work/a")?.id).toBe("new");
    expect(pickFirstWorkspaceSidebarHistorySession(sessions, "/work/missing")).toBeNull();
  });
});

describe("filter monitor items by repository", () => {
  test("employees / dispatches / teams match path", () => {
    const employees: EmployeeMonitorItem[] = [
      {
        employeeId: "e1",
        name: "Worker",
        agentType: "general",
        status: "idle",
        previewText: "",
        updatedAt: 1,
        repositoryPath: "/work/a",
      },
      {
        employeeId: "e2",
        name: "Other",
        agentType: "general",
        status: "idle",
        previewText: "",
        updatedAt: 1,
        repositoryPath: "/work/b",
      },
    ];
    const dispatches: SessionConversationTaskItem[] = [
      {
        key: "d1",
        label: "task",
        status: "running",
        previewText: "",
        updatedAt: 1,
        source: "execution_environment",
        repositoryPath: "/work/a",
      },
    ];
    const teams: TeamMonitorItem[] = [
      {
        workflowId: "w1",
        workflowName: "flow",
        status: "idle",
        previewText: "",
        progressText: "",
        updatedAt: 1,
        repositoryPath: "/work/a",
      },
      {
        workflowId: "w2",
        workflowName: "no-path",
        status: "idle",
        previewText: "",
        progressText: "",
        updatedAt: 1,
      },
    ];
    expect(filterEmployeeMonitorForRepository(employees, "/work/a").map((e) => e.employeeId)).toEqual([
      "e1",
    ]);
    expect(filterDispatchTasksForRepository(dispatches, "/work/a")).toHaveLength(1);
    expect(filterTeamMonitorForRepository(teams, "/work/a").map((t) => t.workflowId)).toEqual(["w1"]);
  });
});

describe("sort running first", () => {
  test("employees running before idle", () => {
    const items: EmployeeMonitorItem[] = [
      {
        employeeId: "idle",
        name: "Idle",
        agentType: "general",
        status: "idle",
        previewText: "",
        updatedAt: 20,
      },
      {
        employeeId: "run",
        name: "Run",
        agentType: "general",
        status: "in_progress",
        previewText: "",
        updatedAt: 10,
      },
    ];
    expect(sortEmployeeMonitorRunningFirst(items).map((i) => i.employeeId)).toEqual(["run", "idle"]);
  });

  test("dispatches running before completed", () => {
    const items: SessionConversationTaskItem[] = [
      {
        key: "done",
        label: "done",
        status: "completed",
        previewText: "",
        updatedAt: 30,
        source: "execution_environment",
      },
      {
        key: "run",
        label: "run",
        status: "running",
        previewText: "",
        updatedAt: 10,
        source: "execution_environment",
      },
    ];
    expect(sortDispatchTasksRunningFirst(items).map((i) => i.key)).toEqual(["run", "done"]);
  });
});

describe("formatWorkspaceSidebarRelativeTime", () => {
  test("returns compact units", () => {
    const now = Date.now();
    expect(formatWorkspaceSidebarRelativeTime(now - 10_000)).toBe("刚刚");
    expect(formatWorkspaceSidebarRelativeTime(now - 120_000)).toBe("2m");
    expect(formatWorkspaceSidebarRelativeTime(now - 7_200_000)).toBe("2h");
    expect(formatWorkspaceSidebarRelativeTime(now - 2 * 86_400_000)).toBe("2d");
  });
});
