import { describe, expect, test } from "bun:test";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  Repository,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../types";
import { bumpSessionCreatedAtForSortActivity } from "../components/ClaudeSessions/sessionGrouping";
import {
  buildWorkspaceSidebarTreeRows,
  collectFlatWorkspaceRepositories,
  filterDispatchTasksForRepository,
  filterEmployeeMonitorForRepository,
  filterTeamMonitorForRepository,
  formatWorkspaceSidebarRelativeTime,
  listWorkspaceSidebarHistorySessions,
  pickFirstWorkspaceSidebarHistorySession,
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

  test("隐藏代码审查工具会话，且不让它成为默认激活项", () => {
    const sessions = [
      makeSession("review", "/work/a", {
        createdAt: 300,
        content: "你是 Wise 内置的代码审查引擎（对标 Cursor Bugbot 的本地审查体验）。",
      }),
      makeSession("real", "/work/a", { createdAt: 200, content: "你好" }),
    ];
    expect(listWorkspaceSidebarHistorySessions(sessions, "/work/a").map((s) => s.id)).toEqual([
      "real",
    ]);
    expect(pickFirstWorkspaceSidebarHistorySession(sessions, "/work/a")?.id).toBe("real");
  });

  test("pickFirstWorkspaceSidebarHistorySession returns list head", () => {
    const sessions = [
      makeSession("old", "/work/a", { createdAt: 100, content: "old" }),
      makeSession("new", "/work/a", { createdAt: 200 }),
    ];
    expect(pickFirstWorkspaceSidebarHistorySession(sessions, "/work/a")?.id).toBe("new");
    expect(pickFirstWorkspaceSidebarHistorySession(sessions, "/work/missing")).toBeNull();
  });

  test("recycled hello session stays above empty draft after sort-activity bump", () => {
    const t0 = 1_700_000_000_000;
    const hello = makeSession("hello", "/work/a", { createdAt: t0, content: "你好" });
    hello.messages = [
      { id: "u1", role: "user", content: "你好", timestamp: t0 + 5_000 },
      { id: "a1", role: "assistant", content: "hi", timestamp: t0 + 6_000 },
    ];
    const draft = makeSession("draft", "/work/a", { createdAt: t0 + 4_000 });
    const before = listWorkspaceSidebarHistorySessions([hello, draft], "/work/a");
    expect(before.map((s) => s.id)).toEqual(["hello", "draft"]);

    const recycled: ClaudeSession = {
      ...hello,
      createdAt: bumpSessionCreatedAtForSortActivity(hello),
      messages: [],
      diskPreview: "你好",
    };
    const after = listWorkspaceSidebarHistorySessions([recycled, draft], "/work/a");
    expect(after.map((s) => s.id)).toEqual(["hello", "draft"]);
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

describe("buildWorkspaceSidebarTreeRows", () => {
  test("mixes sessions and run items by updatedAt, newest first (dispatch not pinned)", () => {
    const t0 = 1_700_000_000_000;
    const sessions = [
      makeSession("sess-new", "/work/a", { createdAt: t0 + 300, content: "latest chat" }),
      makeSession("sess-old", "/work/a", { createdAt: t0 + 50, content: "old chat" }),
    ];
    const dispatches: SessionConversationTaskItem[] = [
      {
        key: "dispatch-mid",
        label: "派发任务",
        status: "running",
        previewText: "",
        updatedAt: t0 + 200,
        source: "execution_environment",
        repositoryPath: "/work/a",
      },
    ];
    const employees: EmployeeMonitorItem[] = [
      {
        employeeId: "emp-old",
        name: "终端",
        agentType: "general",
        status: "in_progress",
        previewText: "",
        updatedAt: t0 + 100,
        repositoryPath: "/work/a",
      },
    ];

    const rows = buildWorkspaceSidebarTreeRows({
      sessions,
      repositoryPath: "/work/a",
      employeeMonitorItems: employees,
      sessionConversationTaskItems: dispatches,
    });

    expect(rows.map((r) => r.kind)).toEqual(["session", "dispatch", "employee", "session"]);
    expect(rows.map((r) => r.updatedAt)).toEqual([t0 + 300, t0 + 200, t0 + 100, t0 + 50]);
    expect(rows[0]!.kind === "session" && rows[0].item.id).toBe("sess-new");
    expect(rows[1]!.kind === "dispatch" && rows[1].item.key).toBe("dispatch-mid");
  });

  test("hides run items when showRunItems is false", () => {
    const rows = buildWorkspaceSidebarTreeRows({
      sessions: [makeSession("s1", "/work/a", { createdAt: 10, content: "hi" })],
      repositoryPath: "/work/a",
      showRunItems: false,
      sessionConversationTaskItems: [
        {
          key: "d1",
          label: "派发",
          status: "running",
          previewText: "",
          updatedAt: 999,
          source: "execution_environment",
          repositoryPath: "/work/a",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("session");
  });

  test("equal updatedAt keeps stable order by session id", () => {
    const rows = buildWorkspaceSidebarTreeRows({
      sessions: [
        makeSession("sess-b", "/work/a", { createdAt: 100, content: "b" }),
        makeSession("sess-a", "/work/a", { createdAt: 100, content: "a" }),
      ],
      repositoryPath: "/work/a",
      showRunItems: false,
    });
    expect(rows.map((r) => (r.kind === "session" ? r.item.id : ""))).toEqual([
      "sess-a",
      "sess-b",
    ]);
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
