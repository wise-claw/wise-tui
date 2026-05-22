import { describe, expect, it } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveClaudeProcessWorkspaceLabels } from "./resolveClaudeProcessWorkspaceLabels";

describe("resolveClaudeProcessWorkspaceLabels", () => {
  const projects: ProjectItem[] = [
    {
      id: "hr",
      name: "华润",
      rootPath: "/work/hr",
      repositoryIds: [10],
      createdAt: "0",
      updatedAt: "0",
    },
  ];
  const repositories: Repository[] = [
    {
      id: 10,
      name: "vocs-web",
      path: "/work/hr/vocs-web",
      repositoryType: "frontend",
      createdAt: "0",
      updatedAt: "0",
    },
  ];

  it("resolves project and repository for wise tab session", () => {
    const session: ClaudeSession = {
      id: "s1",
      claudeSessionId: "sid-1",
      repositoryPath: "/work/hr/vocs-web",
      repositoryName: "vocs-web",
      model: "sonnet",
      status: "running",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
    };
    const labels = resolveClaudeProcessWorkspaceLabels({
      session,
      projects,
      repositories,
      bindings: { "/work/hr/vocs-web": "s1" },
      sessions: [session],
    });
    expect(labels.scopeTitle).toBe("华润 · vocs-web");
    expect(labels.projectName).toBe("华润");
    expect(labels.repositoryName).toBe("vocs-web");
  });

  it("resolves repository for host scan row via claudeSessionId binding", () => {
    const hostRow: ClaudeSession = {
      id: "__wise_host_claude__:99",
      claudeSessionId: "sid-bound",
      repositoryPath: "—",
      repositoryName: "—",
      model: "—",
      status: "running",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
    };
    const tab: ClaudeSession = {
      id: "tab-1",
      claudeSessionId: "sid-bound",
      repositoryPath: "/work/hr/vocs-web",
      repositoryName: "vocs-web",
      model: "sonnet",
      status: "running",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
    };
    const labels = resolveClaudeProcessWorkspaceLabels({
      session: hostRow,
      projects,
      repositories,
      bindings: { "/work/hr/vocs-web": "tab-1" },
      sessions: [tab],
      claudeSessionId: "sid-bound",
    });
    expect(labels.scopeTitle).toBe("华润 · vocs-web");
    expect(labels.repositoryName).toBe("vocs-web");
  });
});
