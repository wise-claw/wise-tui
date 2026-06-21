import { describe, expect, test } from "bun:test";
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import {
  buildEmployeeTerminalConversationStatusById,
  buildEmployeeTerminalLastMessagePreviewById,
  resolveEmployeeTerminalConversationStatus,
  resolveEmployeeTerminalLastMessagePreview,
} from "./employeeTerminalDispatchStatus";

function session(overrides: Partial<ClaudeSession> & { id: string }): ClaudeSession {
  return {
    id: overrides.id,
    repositoryPath: overrides.repositoryPath ?? "/repo/eco",
    repositoryName: overrides.repositoryName ?? "eco-crawler",
    status: overrides.status ?? "idle",
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

function dispatchTask(
  overrides: Partial<SessionConversationTaskItem> & { key: string },
): SessionConversationTaskItem {
  return {
    key: overrides.key,
    label: overrides.label ?? "任务",
    status: overrides.status ?? "running",
    previewText: overrides.previewText ?? "",
    updatedAt: overrides.updatedAt ?? 100,
    source: overrides.source ?? "execution_environment",
    sessionId: overrides.sessionId,
    subtitle: overrides.subtitle,
    repositoryPath: overrides.repositoryPath ?? "/repo/eco",
  };
}

describe("resolveEmployeeTerminalConversationStatus", () => {
  test("maps execution environment task to uniquely named codex terminal", () => {
    const worker = session({
      id: "worker-codex",
      repositoryName: "eco-crawler/执行环境:codex:任务",
      status: "running",
      messages: [{ id: 1, role: "user", content: "hi", timestamp: 50 }],
    });
    const status = resolveEmployeeTerminalConversationStatus({
      employeeName: "codex",
      repositoryPath: "/repo/eco",
      sessions: [worker],
      dispatchTasks: [
        dispatchTask({
          key: "t1",
          sessionId: "worker-codex",
          subtitle: "Codex",
          status: "running",
          updatedAt: 200,
        }),
      ],
      panelEmployeeNames: ["终端01", "codex"],
    });
    expect(status).toBe("running");
  });

  test("maps terminal worker bound to 终端01", () => {
    const worker = session({
      id: "worker-t1",
      repositoryName: "eco-crawler/员工:终端01",
      status: "completed",
      messages: [
        { id: 1, role: "user", content: "run", timestamp: 10 },
        { id: 2, role: "assistant", content: "done", timestamp: 20 },
      ],
    });
    const status = resolveEmployeeTerminalConversationStatus({
      employeeName: "终端01",
      repositoryPath: "/repo/eco",
      sessions: [worker],
      dispatchTasks: [],
      panelEmployeeNames: ["终端01", "终端02"],
    });
    expect(status).toBe("completed");
  });

  test("prefers running dispatch task over idle terminal worker", () => {
    const worker = session({
      id: "worker-t1",
      repositoryName: "eco-crawler/员工:终端01",
      status: "running",
      messages: [{ id: 1, role: "user", content: "new", timestamp: 30 }],
    });
    const status = resolveEmployeeTerminalConversationStatus({
      employeeName: "终端01",
      repositoryPath: "/repo/eco",
      sessions: [worker],
      dispatchTasks: [
        dispatchTask({
          key: "t1",
          sessionId: "worker-t1",
          status: "running",
          updatedAt: 300,
        }),
      ],
      panelEmployeeNames: ["终端01"],
    });
    expect(status).toBe("running");
  });
});

describe("buildEmployeeTerminalConversationStatusById", () => {
  test("builds per-employee map", () => {
    const map = buildEmployeeTerminalConversationStatusById({
      employeeItems: [
        { employeeId: "e1", name: "终端01" },
        { employeeId: "e2", name: "codex" },
      ],
      repositoryPath: "/repo/eco",
      sessions: [
        session({
          id: "w1",
          repositoryName: "eco-crawler/员工:终端01",
          status: "completed",
          messages: [
            { id: 1, role: "user", content: "a", timestamp: 1 },
            { id: 2, role: "assistant", content: "b", timestamp: 2 },
          ],
        }),
      ],
      dispatchTasks: [],
    });
    expect(map.get("e1")).toBe("completed");
    expect(map.get("e2")).toBe("idle");
  });

  test("uses per-employee repositoryPath when fallback is empty", () => {
    const map = buildEmployeeTerminalConversationStatusById({
      employeeItems: [
        { employeeId: "e1", name: "终端01", repositoryPath: "/repo/wise-tui" },
      ],
      repositoryPath: "",
      sessions: [
        session({
          id: "w1",
          repositoryPath: "/repo/wise-tui",
          repositoryName: "wise-tui/员工:终端01",
          status: "running",
          messages: [{ id: 1, role: "user", content: "go", timestamp: 1 }],
        }),
      ],
      dispatchTasks: [],
    });
    expect(map.get("e1")).toBe("running");
  });
});

describe("resolveEmployeeTerminalLastMessagePreview", () => {
  test("returns assistant summary for settled terminal worker", () => {
    const worker = session({
      id: "w1",
      repositoryName: "eco-crawler/员工:终端01",
      status: "completed",
      messages: [
        { id: 1, role: "user", content: "run css", timestamp: 1 },
        { id: 2, role: "assistant", content: "全部完成。改动总结如下。", timestamp: 2 },
      ],
    });
    const preview = resolveEmployeeTerminalLastMessagePreview({
      employeeName: "终端01",
      repositoryPath: "/repo/eco",
      sessions: [worker],
      dispatchTasks: [],
      panelEmployeeNames: ["终端01"],
      conversationStatus: "completed",
    });
    expect(preview).toContain("全部完成");
  });

  test("returns empty while running", () => {
    expect(
      resolveEmployeeTerminalLastMessagePreview({
        employeeName: "终端01",
        repositoryPath: "/repo/eco",
        sessions: [],
        dispatchTasks: [],
        panelEmployeeNames: ["终端01"],
        conversationStatus: "running",
      }),
    ).toBe("");
  });
});

describe("buildEmployeeTerminalLastMessagePreviewById", () => {
  test("builds per-employee preview map", () => {
    const map = buildEmployeeTerminalLastMessagePreviewById({
      employeeItems: [
        { employeeId: "e1", name: "终端01" },
        { employeeId: "e2", name: "终端02" },
      ],
      repositoryPath: "/repo/eco",
      sessions: [
        session({
          id: "w1",
          repositoryName: "eco-crawler/员工:终端01",
          status: "completed",
          messages: [
            { id: 1, role: "user", content: "a", timestamp: 1 },
            { id: 2, role: "assistant", content: "终端01 已完成", timestamp: 2 },
          ],
        }),
      ],
      dispatchTasks: [],
      conversationStatusById: new Map([
        ["e1", "completed"],
        ["e2", "idle"],
      ]),
    });
    expect(map.get("e1")).toContain("终端01 已完成");
    expect(map.get("e2")).toBe("");
  });
});
