import { describe, expect, it } from "bun:test";
import type { ClaudeSession, Repository } from "../types";
import {
  isRepositoryMainSessionTab,
  projectMainSessionBindingKey,
  parseRepositorySideSessionBindings,
  repositoryPathsMatch,
  sessionMatchesRepositoryScope,
  resolveBoundMainSessionId,
  resolveRepositoryByClaudeSessionId,
  resolveRepositoryForSession,
  resolveRepositoryMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "./repositoryMainSessionBinding";

function session(path: string, repositoryName: string): ClaudeSession {
  return {
    id: "s1",
    claudeSessionId: null,
    repositoryPath: path,
    repositoryName,
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("isRepositoryMainSessionTab", () => {
  const key = "/p/r";

  it("treats non-employee tab as main when no agent configured", () => {
    expect(isRepositoryMainSessionTab(session(key, "r"), key, null)).toBe(true);
    expect(isRepositoryMainSessionTab(session(key, "r/员工:ex"), key, null)).toBe(false);
  });

  it("treats only matching employee as main when agent configured", () => {
    expect(isRepositoryMainSessionTab(session(key, "r/员工:executor"), key, "executor")).toBe(true);
    expect(isRepositoryMainSessionTab(session(key, "r/员工:other"), key, "executor")).toBe(false);
    expect(isRepositoryMainSessionTab(session(key, "r"), key, "executor")).toBe(false);
  });
});

describe("resolveMainOwnerAgentNameForRepositoryPath", () => {
  it("returns trimmed name when path matches", () => {
    const repos: Repository[] = [
      {
        id: 1,
        name: "r",
        path: "/p/r",
        repositoryType: "frontend",
        createdAt: "0",
        updatedAt: "0",
        mainOwnerAgentName: " executor ",
      },
    ];
    expect(resolveMainOwnerAgentNameForRepositoryPath(repos, "/p/r")).toBe("executor");
  });
});

describe("projectMainSessionBindingKey", () => {
  it("resolves project binding without matching session.repositoryPath to key", () => {
    const projectSession = session("/work/hr/vocs-web", "Project: 华润");
    const bindings = {
      [projectMainSessionBindingKey("hr")]: "s1",
    };
    expect(
      resolveBoundMainSessionId(projectMainSessionBindingKey("hr"), bindings, [projectSession], null),
    ).toBe("s1");
  });

  it("resolves project binding even when repositoryName lost Project: prefix after disk refresh", () => {
    const projectSession = session("/work/ai-research", "Trellis");
    const bindings = {
      [projectMainSessionBindingKey("ai-research")]: "s1",
    };
    expect(
      resolveBoundMainSessionId(
        projectMainSessionBindingKey("ai-research"),
        bindings,
        [projectSession],
        null,
      ),
    ).toBe("s1");
  });
});

describe("project-rooted main session matching", () => {
  const projectRootSession: ClaudeSession = {
    id: "project-main",
    claudeSessionId: null,
    repositoryPath: "/work/demo",
    repositoryName: "Project: Demo",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
  };

  const repos: Repository[] = [
    {
      id: 1,
      name: "web",
      path: "/work/demo/web",
      repositoryType: "frontend",
      createdAt: "0",
      updatedAt: "0",
    },
    {
      id: 2,
      name: "api",
      path: "/work/demo/api",
      repositoryType: "backend",
      createdAt: "0",
      updatedAt: "0",
    },
  ];

  it("treats project-rooted tab as repository main session target", () => {
    expect(isRepositoryMainSessionTab(projectRootSession, "/work/demo/web", null)).toBe(true);
    expect(isRepositoryMainSessionTab(projectRootSession, "/work/demo/api", null)).toBe(true);
  });

  it("resolves project-rooted binding for repository main session lookup", () => {
    const bindings = {
      "/work/demo": "project-main",
    };
    expect(
      resolveRepositoryMainSessionId("/work/demo/web", bindings, [projectRootSession], null),
    ).toBe("project-main");
  });

  it("maps project-rooted session back to preferred repository", () => {
    const bindings = {
      "/work/demo": "project-main",
    };
    expect(
      resolveRepositoryForSession({
        session: projectRootSession,
        repositories: repos,
        bindings,
        sessions: [projectRootSession],
        preferredRepositoryId: 2,
      })?.id,
    ).toBe(2);
  });
});

describe("binding value as claudeSessionId", () => {
  const repos: Repository[] = [
    {
      id: 10,
      name: "vocs-web",
      path: "/work/hr/vocs-web",
      repositoryType: "frontend",
      createdAt: "0",
      updatedAt: "0",
    },
  ];
  const tab: ClaudeSession = {
    id: "tab-1",
    claudeSessionId: "claude-sid-abc",
    repositoryPath: "/work/hr/vocs-web",
    repositoryName: "vocs-web",
    model: "sonnet",
    status: "running",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
  };

  it("resolveBoundMainSessionId accepts migrated binding value", () => {
    const bindings = { "/work/hr/vocs-web": "claude-sid-abc" };
    expect(resolveBoundMainSessionId("/work/hr/vocs-web", bindings, [tab], null)).toBe("tab-1");
  });

  it("resolveRepositoryByClaudeSessionId uses binding when tab is missing", () => {
    const bindings = { "/work/hr/vocs-web": "claude-sid-abc" };
    expect(
      resolveRepositoryByClaudeSessionId({
        claudeSessionId: "claude-sid-abc",
        repositories: repos,
        bindings,
        sessions: [],
      })?.name,
    ).toBe("vocs-web");
  });
});

describe("sessionMatchesRepositoryScope", () => {
  it("matches member repo and project-rooted parent session", () => {
    const projectSession: ClaudeSession = {
      id: "p1",
      claudeSessionId: null,
      repositoryPath: "/eco",
      repositoryName: "Project: eco",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 0,
      pendingPrompt: "",
    };
    expect(sessionMatchesRepositoryScope(projectSession, "/eco/eco-ai-web")).toBe(true);
    expect(sessionMatchesRepositoryScope(projectSession, "/eco/other-repo")).toBe(true);
    expect(sessionMatchesRepositoryScope(projectSession, "/other")).toBe(false);
  });
});

describe("repositoryPathsMatch", () => {
  it("treats trailing slash and backslashes as same repo", () => {
    expect(repositoryPathsMatch("/work/repo/", "/work/repo")).toBe(true);
    expect(repositoryPathsMatch("C:\\work\\repo", "C:/work/repo")).toBe(true);
    expect(repositoryPathsMatch("/work/a", "/work/b")).toBe(false);
  });
});

describe("parseRepositorySideSessionBindings", () => {
  it("returns empty record for empty / invalid input", () => {
    expect(parseRepositorySideSessionBindings(null)).toEqual({});
    expect(parseRepositorySideSessionBindings(undefined)).toEqual({});
    expect(parseRepositorySideSessionBindings("")).toEqual({});
    expect(parseRepositorySideSessionBindings("not-json")).toEqual({});
    expect(parseRepositorySideSessionBindings("[]")).toEqual({});
    expect(parseRepositorySideSessionBindings('"string"')).toEqual({});
  });

  it("parses and normalizes keys, strips empty values", () => {
    const parsed = parseRepositorySideSessionBindings(
      JSON.stringify({
        "/work/repo/": "side-1",
        "C:\\work\\repo": "side-2",
        "/work/empty": "  ",
        "/work/bad": 42,
      }),
    );
    expect(parsed["/work/repo"]).toBe("side-1");
    expect(parsed["C:/work/repo"]).toBe("side-2");
    expect(parsed["/work/empty"]).toBeUndefined();
    expect(parsed["/work/bad"]).toBeUndefined();
  });
});
