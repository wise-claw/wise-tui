import { describe, expect, it } from "bun:test";
import type { ClaudeSession, Repository } from "../types";
import { projectMainSessionBindingKey } from "./repositoryMainSessionBinding";
import { buildSidebarRunningMainSessionMaps } from "./sidebarRunningMainSessionIndicators";

function session(
  id: string,
  path: string,
  repositoryName: string,
  claudeSessionId: string | null = null,
): ClaudeSession {
  return {
    id,
    claudeSessionId,
    repositoryPath: path,
    repositoryName,
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("buildSidebarRunningMainSessionMaps", () => {
  const repos: Repository[] = [
    {
      id: 10,
      name: "web",
      path: "/work/hr/web",
      repositoryType: "frontend",
      createdAt: "0",
      updatedAt: "0",
    },
  ];

  const liveProcesses = [
    { pid: 4242, memoryBytes: 0, sessionId: "claude-1", projectPath: null, sessionSource: "resume_arg" },
  ];

  it("does not mark running from UI status without matching host pid", () => {
    const maps = buildSidebarRunningMainSessionMaps({
      projects: [{ id: "hr" }],
      repositories: repos,
      sessions: [session("s-proj", "/work/hr/web", "Project: 华润", "claude-1")],
      bindings: { [projectMainSessionBindingKey("hr")]: "s-proj" },
      claudeProcesses: [],
    });
    expect(maps.runningByProjectId.hr).toBe(false);
  });

  it("marks repository when claude session id maps to a live pid", () => {
    const repoSession = session("s-repo", "/work/hr/web", "web", "claude-1");
    const maps = buildSidebarRunningMainSessionMaps({
      projects: [{ id: "hr" }],
      repositories: repos,
      sessions: [repoSession],
      bindings: { "/work/hr/web": "s-repo" },
      claudeProcesses: liveProcesses,
    });
    expect(maps.runningByRepositoryId[10]).toBe(true);
  });

  it("marks running when live pid correlates by project path without process session id", () => {
    const repoSession = session("s-repo", "/work/hr/web", "web", "claude-1");
    const maps = buildSidebarRunningMainSessionMaps({
      projects: [{ id: "hr" }],
      repositories: repos,
      sessions: [repoSession],
      bindings: { "/work/hr/web": "s-repo" },
      claudeProcesses: [{ pid: 99, memoryBytes: 0, sessionId: null, projectPath: "/work/hr/web", sessionSource: "lsof_jsonl" }],
    });
    expect(maps.runningByRepositoryId[10]).toBe(true);
  });

  it("does not mark running when process path conflicts with bound session id", () => {
    const repoSession = session("s-repo", "/work/hr/web", "web", "claude-1");
    const maps = buildSidebarRunningMainSessionMaps({
      projects: [{ id: "hr" }],
      repositories: repos,
      sessions: [repoSession],
      bindings: { "/work/hr/web": "s-repo" },
      claudeProcesses: [
        { pid: 99, memoryBytes: 0, sessionId: "other-sid", projectPath: "/work/hr/web", sessionSource: "lsof_jsonl" },
      ],
    });
    expect(maps.runningByRepositoryId[10]).toBe(false);
  });
});
