import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  pickProjectMainSessionForSidebarSelect,
  pickSessionForRepositorySidebarSelect,
} from "./claudeSessionSelection";

function session(
  input: Partial<ClaudeSession> & Pick<ClaudeSession, "id" | "repositoryPath">,
): ClaudeSession {
  return {
    id: input.id,
    claudeSessionId: null,
    repositoryPath: input.repositoryPath,
    repositoryName: input.repositoryName ?? input.repositoryPath,
    model: "sonnet",
    status: "idle",
    messages: input.messages ?? [],
    createdAt: input.createdAt ?? 1,
    pendingPrompt: "",
  };
}

describe("project vs repository sidebar session pick", () => {
  const path = "/work/hr/vocs-web";
  const sessions = [
    session({ id: "repo-main", repositoryPath: path, repositoryName: "vocs-web" }),
    session({
      id: "project-main",
      repositoryPath: path,
      repositoryName: "Project: 华润",
      createdAt: 2,
    }),
  ];

  test("pickSessionForRepositorySidebarSelect ignores Project: tabs", () => {
    expect(pickSessionForRepositorySidebarSelect(sessions, path, {})).toEqual(
      sessions.find((s) => s.id === "repo-main") ?? null,
    );
  });

  test("pickProjectMainSessionForSidebarSelect only returns Project: tabs", () => {
    expect(pickProjectMainSessionForSidebarSelect(sessions, path, {})).toEqual(
      sessions.find((s) => s.id === "project-main") ?? null,
    );
  });
});
