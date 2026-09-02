import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  dispatchAtMentionPromptToRepos,
  parseAtMentions,
  planAtMentionDispatch,
  resolveReposByMention,
  resolveReposByTag,
  stripMentionTags,
} from "./atMentionDispatch";

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? `repo-${input.id}`,
    path: input.path,
    repositoryType: input.repositoryType ?? "frontend",
    roleTags: input.roleTags,
    createdAt: "0",
    updatedAt: "0",
  };
}

function project(input: Partial<ProjectItem> & Pick<ProjectItem, "id">): ProjectItem {
  return {
    id: input.id,
    name: input.name ?? "Demo",
    repositoryIds: input.repositoryIds ?? [],
    createdAt: 0,
    updatedAt: 0,
    sddMode: input.sddMode,
    rootPath: input.rootPath,
  };
}

describe("parseAtMentions", () => {
  test("extracts single mention", () => {
    const r = parseAtMentions("@frontend 改按钮");
    expect(r.mentions).toEqual([{ tag: "frontend", index: 0 }]);
    expect(r.strippedBody).toBe("改按钮");
  });

  test("extracts multiple mentions", () => {
    const r = parseAtMentions("@frontend 改按钮 @backend 加接口");
    expect(r.mentions.map((m) => m.tag)).toEqual(["frontend", "backend"]);
    expect(r.strippedBody).toBe("改按钮 加接口");
  });

  test("ignores escaped backslash-at", () => {
    const r = parseAtMentions("\\@frontend 应当不算");
    expect(r.mentions).toEqual([]);
    expect(r.strippedBody).toBe("@frontend 应当不算");
  });

  test("ignores email-style @ (not at word boundary)", () => {
    const r = parseAtMentions("contact me at user@example.com");
    expect(r.mentions).toEqual([]);
  });

  test("respects punctuation boundary on right", () => {
    const r = parseAtMentions("@frontend, 改按钮");
    expect(r.mentions.map((m) => m.tag)).toEqual(["frontend"]);
    expect(r.strippedBody).toBe(", 改按钮");
  });

  test("empty input returns empty", () => {
    expect(parseAtMentions("").mentions).toEqual([]);
    expect(parseAtMentions("").strippedBody).toBe("");
  });

  test("collapses whitespace in strippedBody", () => {
    const r = parseAtMentions("@frontend   改\n按钮  ");
    expect(r.strippedBody).toBe("改 按钮");
  });

  test("supports wider mention tokens such as repo folder names", () => {
    const r = parseAtMentions("@vocs-web 改按钮");
    expect(r.mentions).toEqual([{ tag: "vocs-web", index: 0 }]);
    expect(r.strippedBody).toBe("改按钮");
  });
});

describe("resolveReposByTag", () => {
  const r1 = repo({ id: 1, path: "/r1", roleTags: ["frontend"] });
  const r2 = repo({ id: 2, path: "/r2", roleTags: ["backend", "api"] });
  const r3 = repo({ id: 3, path: "/r3", repositoryType: "frontend" });

  test("matches by roleTags case-insensitively", () => {
    const p = project({ id: "p", repositoryIds: [1, 2, 3] });
    expect(resolveReposByTag("Frontend", p, [r1, r2, r3]).map((r) => r.id)).toEqual([1, 3]);
  });

  test("matches by legacy repositoryType fallback when roleTags missing", () => {
    const p = project({ id: "p", repositoryIds: [3] });
    expect(resolveReposByTag("frontend", p, [r3]).map((r) => r.id)).toEqual([3]);
  });

  test("only considers repos within the project", () => {
    const p = project({ id: "p", repositoryIds: [1] });
    expect(resolveReposByTag("backend", p, [r1, r2]).map((r) => r.id)).toEqual([]);
  });

  test("returns empty for unknown tag", () => {
    const p = project({ id: "p", repositoryIds: [1, 2] });
    expect(resolveReposByTag("nonexistent", p, [r1, r2])).toEqual([]);
  });

  test("returns empty for empty/whitespace tag", () => {
    const p = project({ id: "p", repositoryIds: [1] });
    expect(resolveReposByTag("", p, [r1])).toEqual([]);
    expect(resolveReposByTag("   ", p, [r1])).toEqual([]);
  });
});

describe("resolveReposByMention", () => {
  const r1 = repo({ id: 1, path: "/p/vocs-web", name: "vocs-web", roleTags: ["frontend"] });
  const r2 = repo({ id: 2, path: "/p/hlhb-int", name: "hlhb-int", roleTags: ["backend"] });
  const p = project({ id: "p", repositoryIds: [1, 2] });

  test("prefers an exact workspace repo name over a project roleTag", () => {
    const byName = repo({ id: 3, path: "/p/frontend", name: "frontend", roleTags: ["api"] });
    const projectWithBoth = project({ id: "p2", repositoryIds: [1, 3] });
    expect(resolveReposByMention("frontend", projectWithBoth, [r1, byName]).map((r) => r.id)).toEqual([
      3,
    ]);
  });

  test("matches repositories outside the active project", () => {
    const outside = repo({ id: 8, path: "/other/mobile", name: "mobile" });
    expect(resolveReposByMention("mobile", p, [r1, r2, outside]).map((r) => r.id)).toEqual([8]);
  });

  test("matches repo folder basename when roleTag misses", () => {
    expect(resolveReposByMention("vocs-web", p, [r1, r2]).map((r) => r.id)).toEqual([1]);
  });

  test("matches repo display name case-insensitively", () => {
    expect(resolveReposByMention("HLHB-INT", p, [r1, r2]).map((r) => r.id)).toEqual([2]);
  });
});

describe("planAtMentionDispatch", () => {
  const r1 = repo({ id: 1, path: "/r1", roleTags: ["frontend"] });
  const r2 = repo({ id: 2, path: "/r2", roleTags: ["backend"] });
  const wiseProject = project({
    id: "p",
    repositoryIds: [1, 2],
    sddMode: "wise_trellis",
  });

  test("dispatch when wise_trellis + mention matches", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1, r2],
      prompt: "@frontend 改按钮",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.mentionedTags).toEqual(["frontend"]);
      expect(plan.matchedRepos.map((r) => r.id)).toEqual([1]);
      expect(plan.body).toBe("改按钮");
    }
  });

  test("dispatch when mention matches repo folder name", () => {
    const vocs = repo({ id: 3, path: "/p/vocs-web", name: "vocs-web", roleTags: ["web"] });
    const plan = planAtMentionDispatch({
      activeProject: project({
        id: "p",
        repositoryIds: [3],
        sddMode: "wise_trellis",
      }),
      repositories: [vocs],
      prompt: "@vocs-web 改按钮",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((r) => r.id)).toEqual([3]);
      expect(plan.body).toBe("改按钮");
    }
  });

  test("dispatches for legacy projects whose missing sddMode defaults to wise_trellis", () => {
    const legacyRepo = repo({ id: 4, path: "/p/legacy-web", name: "legacy-web" });
    const plan = planAtMentionDispatch({
      activeProject: project({ id: "legacy", repositoryIds: [4] }),
      repositories: [legacyRepo],
      prompt: "@legacy-web 修复登录页",
    });

    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((r) => r.id)).toEqual([4]);
      expect(plan.body).toBe("修复登录页");
    }
  });

  test("dispatch fans out across multiple tags", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1, r2],
      prompt: "@frontend 改按钮 @backend 加接口",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((r) => r.id).sort()).toEqual([1, 2]);
    }
  });

  test("dispatches to a workspace repository outside the active project", () => {
    const outside = repo({ id: 7, path: "/workspace/mobile", name: "mobile" });
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1, r2, outside],
      prompt: "@mobile 修复构建",
    });

    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((repo) => repo.id)).toEqual([7]);
      expect(plan.body).toBe("修复构建");
    }
  });

  test("dispatches repository mentions in project_owned workspaces", () => {
    const plan = planAtMentionDispatch({
      activeProject: project({ id: "p", sddMode: "project_owned", repositoryIds: [1] }),
      repositories: [r1],
      prompt: "@r1 改按钮",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((repo) => repo.id)).toEqual([1]);
    }
  });

  test("dispatches repository mentions without an active project", () => {
    const standalone = repo({ id: 9, path: "/work/standalone", name: "standalone" });
    const plan = planAtMentionDispatch({
      activeProject: null,
      repositories: [standalone],
      prompt: "@standalone 跑完整测试",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((repo) => repo.id)).toEqual([9]);
      expect(plan.body).toBe("跑完整测试");
    }
  });

  test("fallthrough when no mentions", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1],
      prompt: "just a regular prompt",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "no_mentions" });
  });

  test("dispatches empty body when mention matches a repository", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1],
      prompt: "@frontend",
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.matchedRepos.map((item) => item.id)).toEqual([1]);
      expect(plan.body).toBe("");
    }
  });

  test("warn_then_fallthrough when mention unmatched", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1, r2],
      prompt: "@design 改样式",
    });
    expect(plan.kind).toBe("warn_then_fallthrough");
    if (plan.kind === "warn_then_fallthrough") {
      expect(plan.mentionedTags).toEqual(["design"]);
      expect(plan.body).toBe("改样式");
    }
  });

  test("silently falls through for non-repository mentions without an active project", () => {
    const plan = planAtMentionDispatch({
      activeProject: null,
      repositories: [r1],
      prompt: "@frontend 改按钮",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "no_mentions" });
  });
});

describe("stripMentionTags", () => {
  test("strips only matched repository tags and keeps other @ tokens", () => {
    expect(stripMentionTags("@codex 修登录 @src/app.tsx", ["codex"])).toBe("修登录 @src/app.tsx");
  });

  test("returns empty when prompt is only the repository mention", () => {
    expect(stripMentionTags("@codex", ["codex"])).toBe("");
  });
});

describe("dispatchAtMentionPromptToRepos", () => {
  const r1 = repo({ id: 1, path: "/p/frontend-app", name: "frontend-app", roleTags: ["frontend"] });
  const r2 = repo({ id: 2, path: "/p/backend-app", name: "backend-app", roleTags: ["backend"] });

  test("creates a new session under each matched repository and executes the body", async () => {
    const created: Array<{ path: string; name: string; skipActivate?: boolean }> = [];
    const executed: Array<{ sessionId: string; prompt: string; bubble?: string }> = [];
    const activated: string[] = [];

    const results = await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1, r2],
      mentionedTags: ["frontend", "backend"],
      body: "改按钮 加接口",
      prompt: "@frontend 改按钮 @backend 加接口",
      createSession: async (path, name, opts) => {
        created.push({ path, name, skipActivate: opts?.skipActivate });
        return `sess-${path}`;
      },
      executeSession: (sessionId, prompt, opts) => {
        executed.push({ sessionId, prompt, bubble: opts?.userBubblePrompt });
        return true;
      },
      activateSession: (sessionId) => {
        activated.push(sessionId);
      },
    });

    expect(results.map((item) => item.status)).toEqual(["succeeded", "succeeded"]);
    expect(created).toEqual([
      { path: "/p/frontend-app", name: "frontend-app", skipActivate: true },
      { path: "/p/backend-app", name: "backend-app", skipActivate: true },
    ]);
    expect(executed).toEqual([
      { sessionId: "sess-/p/frontend-app", prompt: "改按钮 加接口", bubble: "改按钮 加接口" },
      { sessionId: "sess-/p/backend-app", prompt: "改按钮 加接口", bubble: "改按钮 加接口" },
    ]);
    expect(activated).toEqual(["sess-/p/frontend-app"]);
  });

  test("does not switch the current session when activateSession is omitted", async () => {
    const activated: string[] = [];
    await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1],
      mentionedTags: ["frontend"],
      body: "改按钮",
      createSession: async () => "sess-1",
      executeSession: () => true,
    });
    expect(activated).toEqual([]);
  });

  test("keeps non-repository @ tokens in the executed prompt", async () => {
    const executed: Array<{ prompt: string; bubble?: string }> = [];
    await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1],
      mentionedTags: ["frontend-app"],
      body: "看看 @src/app.tsx",
      prompt: "@frontend-app 看看 @src/app.tsx",
      createSession: async () => "sess-1",
      executeSession: (_sessionId, prompt, opts) => {
        executed.push({ prompt, bubble: opts?.userBubblePrompt });
        return true;
      },
    });
    expect(executed).toEqual([
      { prompt: "看看 @src/app.tsx", bubble: "看看 @src/app.tsx" },
    ]);
  });

  test("empty body still creates a session under the target repository without executing", async () => {
    const executed: string[] = [];
    const results = await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1],
      mentionedTags: ["frontend"],
      body: "",
      prompt: "@frontend",
      createSession: async (path) => `sess-${path}`,
      executeSession: (sessionId) => {
        executed.push(sessionId);
        return true;
      },
    });

    expect(results).toEqual([
      {
        repositoryId: 1,
        repositoryPath: "/p/frontend-app",
        status: "succeeded",
        sessionId: "sess-/p/frontend-app",
        summary: "在 frontend-app 下新建会话",
      },
    ]);
    expect(executed).toEqual([]);
  });

  test("repo failure does not abort other repos", async () => {
    const closed: string[] = [];
    const results = await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1, r2],
      mentionedTags: ["frontend"],
      body: "改按钮",
      createSession: async (path) => {
        if (path === "/p/frontend-app") throw new Error("create failed");
        return "sess-ok";
      },
      executeSession: () => true,
      closeSession: (sessionId) => {
        closed.push(sessionId);
      },
    });

    const byId = new Map(results.map((item) => [item.repositoryId, item]));
    expect(byId.get(1)?.status).toBe("failed");
    expect(byId.get(1)?.errorMessage).toContain("create failed");
    expect(byId.get(2)?.status).toBe("succeeded");
    expect(byId.get(2)?.sessionId).toBe("sess-ok");
    expect(closed).toEqual([]);
  });

  test("executeSession returning false closes the empty session", async () => {
    const closed: string[] = [];
    const results = await dispatchAtMentionPromptToRepos({
      matchedRepos: [r1],
      mentionedTags: ["frontend"],
      body: "改按钮",
      createSession: async () => "sess-1",
      executeSession: () => false,
      closeSession: (sessionId) => {
        closed.push(sessionId);
      },
    });
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.errorMessage).toContain("并发上限");
    expect(closed).toEqual(["sess-1"]);
  });
});
