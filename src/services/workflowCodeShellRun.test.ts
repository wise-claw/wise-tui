import { describe, expect, test } from "bun:test";
import {
  buildWorkflowShellRunCommand,
  resolveWorkflowCodeWorkingDirectory,
} from "./workflowCodeShellRun";
import { advanceWorkflowGraph, createWorkflowRuntimeState } from "./workflowGraphRuntime";
import type { WorkflowGraph } from "../types";

describe("workflowCodeShellRun", () => {
  test("command mode uses source as-is", () => {
    expect(buildWorkflowShellRunCommand({ mode: "command", source: "echo hi" }, "echo hi")).toEqual({
      ok: true,
      command: "echo hi",
    });
  });

  test("script mode wraps with zsh -c", () => {
    const built = buildWorkflowShellRunCommand({ mode: "script", source: "echo a\necho b" }, "echo a\necho b");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.command.startsWith("zsh -c ")).toBe(true);
      expect(built.command).toContain("echo a");
    }
  });

  test("resolves relative working directory under repo root", () => {
    expect(resolveWorkflowCodeWorkingDirectory("/repo", "scripts")).toBe("/repo/scripts");
    expect(resolveWorkflowCodeWorkingDirectory("/repo", "../x")).toBe("/repo");
  });
});

describe("advanceWorkflowGraph shell code node", () => {
  function node(id: string, type: WorkflowGraph["nodes"][number]["type"], label: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      type,
      position: { x: 0, y: 0 },
      data: { label, ...extra },
    };
  }

  test("stops at shell code node instead of skipping to task", () => {
    const start = node("start", "start", "开始");
    const code = node("code-1", "code", "代码执行", {
      codeLanguage: "shell",
      codeMode: "command",
      codeSource: "echo hello",
      codeScript: "echo hello",
    });
    const task = node("task-1", "task", "智能体阶段", { employeeId: "emp-1" });
    const end = node("end", "end", "结束");
    const graph: WorkflowGraph = {
      nodes: [start, code, task, end],
      edges: [
        { id: "e1", source: "start", target: "code-1" },
        { id: "e2", source: "code-1", target: "task-1" },
        { id: "e3", source: "task-1", target: "end" },
      ],
    };
    const result = advanceWorkflowGraph({
      graph,
      state: createWorkflowRuntimeState(graph),
      startContent: "run me",
    });
    expect(result.dispatch?.nodeId).toBe("code-1");
    expect(result.dispatch?.nodeType).toBe("code");
    expect(result.dispatch?.input).toBe("echo hello");
  });

  test("advances from code node to task with lastOutput", () => {
    const start = node("start", "start", "开始");
    const code = node("code-1", "code", "代码执行", {
      codeLanguage: "shell",
      codeMode: "command",
      codeSource: "echo hello",
    });
    const task = node("task-1", "task", "智能体阶段", { employeeId: "emp-1" });
    const end = node("end", "end", "结束");
    const graph: WorkflowGraph = {
      nodes: [start, code, task, end],
      edges: [
        { id: "e1", source: "start", target: "code-1" },
        { id: "e2", source: "code-1", target: "task-1" },
        { id: "e3", source: "task-1", target: "end" },
      ],
    };
    const first = advanceWorkflowGraph({
      graph,
      state: createWorkflowRuntimeState(graph),
      startContent: "run me",
    });
    const second = advanceWorkflowGraph({
      graph,
      state: first.state,
      startContent: "run me",
      lastOutput: "hello\nexit_code=0",
    });
    expect(second.dispatch?.nodeId).toBe("task-1");
    expect(second.dispatch?.nodeType).toBe("task");
  });
});
