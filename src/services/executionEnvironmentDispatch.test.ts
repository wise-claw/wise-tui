import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { resetExecutionEnvironmentDispatchStore } from "../stores/executionEnvironmentDispatchStore";
import { dispatchExecutionEnvironmentFromMainSession } from "./executionEnvironmentDispatch";

function stubSession(id: string): ClaudeSession {
  return {
    id,
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "demo",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: Date.now(),
    pendingPrompt: "",
  };
}

describe("dispatchExecutionEnvironmentFromMainSession", () => {
  beforeEach(() => {
    resetExecutionEnvironmentDispatchStore();
  });

  test("无默认指令时不加载 slash catalog，并并行创建 worker", async () => {
    const loadInstructionResolveContext = mock(async () => ({
      omcInstalled: false,
      pluginCacheSkills: [],
      projectSkills: [],
    }));
    const createdNames: string[] = [];
    const executed: string[] = [];
    const sessions = [stubSession("main")];

    const ok = await dispatchExecutionEnvironmentFromMainSession(
      {
        getSessions: () => sessions,
        loadInstructionResolveContext,
        createSession: async (_path, name) => {
          createdNames.push(name);
          const id = `worker-${createdNames.length}`;
          sessions.push(stubSession(id));
          return id;
        },
        executeSession: (workerTabId) => {
          executed.push(workerTabId);
          return true;
        },
        appendSystemMessage: () => {},
      },
      {
        mainSessionId: "main",
        prompt: "@Claude Code 起2个会话修登录",
      },
    );

    expect(ok).toBe(true);
    expect(loadInstructionResolveContext).not.toHaveBeenCalled();
    expect(createdNames).toHaveLength(2);
    expect(executed).toHaveLength(2);
  });

  test("有默认指令时才加载 resolve context", async () => {
    const loadInstructionResolveContext = mock(async () => ({
      omcInstalled: false,
      pluginCacheSkills: [],
      projectSkills: [],
    }));
    const sessions = [stubSession("main")];

    await dispatchExecutionEnvironmentFromMainSession(
      {
        getSessions: () => sessions,
        loadInstructionResolveContext,
        createSession: async () => {
          const id = "worker-1";
          sessions.push(stubSession(id));
          return id;
        },
        executeSession: () => true,
        appendSystemMessage: () => {},
      },
      {
        mainSessionId: "main",
        prompt: "@Claude Code 修登录",
        defaultInstructionApplied: "/autopilot",
      },
    );

    expect(loadInstructionResolveContext).toHaveBeenCalledTimes(1);
  });
});
