import { describe, expect, it } from "bun:test";
import type { ClaudeSession, Repository } from "../types";
import {
  isRepositoryMainSessionTab,
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
