import { describe, expect, test } from "bun:test";
import type { ClaudeInvocationResult } from "./claude";
import type { ProjectItem, Repository } from "../types";
import {
  dispatchAtMentionPromptToRepos,
  parseAtMentions,
  planAtMentionDispatch,
  resolveReposByMention,
  resolveReposByTag,
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

function okInvocation(): ClaudeInvocationResult {
  return {
    success: true,
    exitCode: 0,
    outputLines: [],
    errorLines: [],
    durationMs: 1,
    invocationKey: "k",
  } as unknown as ClaudeInvocationResult;
}

function failedInvocation(message: string): ClaudeInvocationResult {
  return {
    success: false,
    exitCode: 1,
    outputLines: [],
    errorLines: [message],
    durationMs: 1,
    invocationKey: "k",
  } as unknown as ClaudeInvocationResult;
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

  test("prefers roleTag match over repo name", () => {
    const byName = repo({ id: 3, path: "/p/frontend", name: "frontend", roleTags: ["api"] });
    const projectWithBoth = project({ id: "p2", repositoryIds: [1, 3] });
    expect(resolveReposByMention("frontend", projectWithBoth, [r1, byName]).map((r) => r.id)).toEqual([
      1,
    ]);
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

  test("fallthrough when project not wise_trellis", () => {
    const plan = planAtMentionDispatch({
      activeProject: project({ id: "p", sddMode: "project_owned", repositoryIds: [1] }),
      repositories: [r1],
      prompt: "@frontend 改按钮",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "not_wise_trellis" });
  });

  test("fallthrough when no mentions", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1],
      prompt: "just a regular prompt",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "no_mentions" });
  });

  test("fallthrough when body is empty", () => {
    const plan = planAtMentionDispatch({
      activeProject: wiseProject,
      repositories: [r1],
      prompt: "@frontend",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "empty_body" });
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

  test("fallthrough when activeProject is null", () => {
    const plan = planAtMentionDispatch({
      activeProject: null,
      repositories: [r1],
      prompt: "@frontend 改按钮",
    });
    expect(plan).toEqual({ kind: "fallthrough", reason: "not_wise_trellis" });
  });
});

describe("dispatchAtMentionPromptToRepos", () => {
  const r1 = repo({ id: 1, path: "/r1", roleTags: ["frontend"] });
  const r2 = repo({ id: 2, path: "/r2", roleTags: ["backend"] });
  const wiseProject = project({
    id: "p",
    repositoryIds: [1, 2],
    rootPath: "/p",
    sddMode: "wise_trellis",
  });

  test("per-repo invocation succeeds when invokeClaude returns success", async () => {
    const invokeCalls: Array<{ cwd: string; prompt: string }> = [];
    const results = await dispatchAtMentionPromptToRepos({
      project: wiseProject,
      matchedRepos: [r1, r2],
      body: "改按钮",
      sessionId: "sess-1",
      invokeClaude: async ({ repositoryPath, prompt }) => {
        invokeCalls.push({ cwd: repositoryPath, prompt });
        return okInvocation();
      },
      prepareWorktree: async (repoPath, taskId) => ({
        worktreePath: `${repoPath}-wt-${taskId}`,
        branchName: "wt",
      }),
      nowMs: () => 1000,
    });

    expect(results.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    expect(results.map((r) => r.repositoryId).sort()).toEqual([1, 2]);
    expect(invokeCalls).toHaveLength(2);
    expect(invokeCalls.every((c) => c.prompt.includes("改按钮"))).toBe(true);
    expect(invokeCalls.every((c) => c.prompt.includes("Active project: Demo"))).toBe(true);
  });

  test("repo failure does not abort other repos", async () => {
    const results = await dispatchAtMentionPromptToRepos({
      project: wiseProject,
      matchedRepos: [r1, r2],
      body: "改按钮",
      sessionId: "sess-1",
      invokeClaude: async ({ repositoryPath }) => {
        if (repositoryPath.startsWith("/r1")) return failedInvocation("boom");
        return okInvocation();
      },
      prepareWorktree: async (repoPath, taskId) => ({
        worktreePath: repoPath,
        branchName: "wt-" + taskId,
      }),
      nowMs: () => 2000,
    });

    const byId = new Map(results.map((r) => [r.repositoryId, r]));
    expect(byId.get(1)?.status).toBe("failed");
    expect(byId.get(1)?.errorMessage).toContain("boom");
    expect(byId.get(2)?.status).toBe("succeeded");
  });

  test("worktree preparation failure surfaces as failed result", async () => {
    const results = await dispatchAtMentionPromptToRepos({
      project: wiseProject,
      matchedRepos: [r1],
      body: "改按钮",
      sessionId: "sess-1",
      prepareWorktree: async () => {
        throw new Error("worktree busy");
      },
      invokeClaude: async () => okInvocation(),
      nowMs: () => 3000,
    });
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.errorMessage).toContain("worktree busy");
  });

  test("synthesized taskId is stable for given nowMs + repo", async () => {
    const results = await dispatchAtMentionPromptToRepos({
      project: wiseProject,
      matchedRepos: [r1],
      body: "改按钮",
      sessionId: "sess-1",
      invokeClaude: async () => okInvocation(),
      prepareWorktree: async (rp, taskId) => ({
        worktreePath: rp,
        branchName: taskId,
      }),
      nowMs: () => 4242,
    });
    expect(results[0]?.taskId).toBe("at-mention-4242-1");
  });
});
