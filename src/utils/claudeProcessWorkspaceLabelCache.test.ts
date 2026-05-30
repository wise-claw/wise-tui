import { describe, expect, it } from "bun:test";
import {
  cacheKeyForPid,
  createClaudeProcessWorkspaceLabelCache,
  lookupClaudeProcessLabelCache,
  pruneClaudeProcessLabelCache,
  rememberClaudeProcessLabelCache,
} from "./claudeProcessWorkspaceLabelCache";

describe("claudeProcessWorkspaceLabelCache", () => {
  it("remembers and resolves by pid when session id is missing", () => {
    const state = createClaudeProcessWorkspaceLabelCache();
    rememberClaudeProcessLabelCache(state, { pid: 11092 }, {
      scopeTitle: "华润 · vocs-web",
      scopeSubtitle: "工作区仓库",
      projectName: "华润",
      repositoryName: "vocs-web",
      repositoryPathKey: "/work/hr/vocs-web",
      updatedAt: 1,
    });
    const hit = lookupClaudeProcessLabelCache(state, { pid: 11092 });
    expect(hit?.scopeTitle).toBe("华润 · vocs-web");
    expect(hit?.repositoryName).toBe("vocs-web");
  });

  it("prefers claude session id over pid when both exist", () => {
    const state = createClaudeProcessWorkspaceLabelCache();
    rememberClaudeProcessLabelCache(
      state,
      { pid: 1 },
      {
        scopeTitle: "旧标签",
        scopeSubtitle: null,
        projectName: null,
        repositoryName: null,
        repositoryPathKey: null,
        updatedAt: 1,
      },
    );
    rememberClaudeProcessLabelCache(
      state,
      { claudeSessionId: "sid-a", pid: 2 },
      {
        scopeTitle: "华澜",
        scopeSubtitle: "工作区",
        projectName: "华澜",
        repositoryName: null,
        repositoryPathKey: "/work/hualan",
        updatedAt: 2,
      },
    );
    const hit = lookupClaudeProcessLabelCache(state, {
      claudeSessionId: "sid-a",
      pid: 1,
    });
    expect(hit?.scopeTitle).toBe("华澜");
    expect(state.byKey.get(cacheKeyForPid(1))?.scopeTitle).toBe("旧标签");
  });

  it("does not store generic host process title", () => {
    const state = createClaudeProcessWorkspaceLabelCache();
    rememberClaudeProcessLabelCache(state, { pid: 9 }, {
      scopeTitle: "本机 Claude 进程",
      scopeSubtitle: null,
      projectName: null,
      repositoryName: null,
      repositoryPathKey: null,
      updatedAt: 1,
    });
    expect(lookupClaudeProcessLabelCache(state, { pid: 9 })).toBeNull();
  });

  it("pruneClaudeProcessLabelCache keeps newest entries only", () => {
    const state = createClaudeProcessWorkspaceLabelCache();
    for (let i = 0; i < 100; i += 1) {
      state.byKey.set(cacheKeyForPid(i + 1), {
        scopeTitle: `repo-${i}`,
        scopeSubtitle: null,
        projectName: null,
        repositoryName: null,
        repositoryPathKey: null,
        updatedAt: i,
      });
    }
    expect(state.byKey.size).toBe(100);
    expect(pruneClaudeProcessLabelCache(state, 96)).toBe(true);
    expect(state.byKey.size).toBe(96);
    expect(lookupClaudeProcessLabelCache(state, { pid: 100 })?.scopeTitle).toBe("repo-99");
    expect(lookupClaudeProcessLabelCache(state, { pid: 1 })).toBeNull();
  });
});
