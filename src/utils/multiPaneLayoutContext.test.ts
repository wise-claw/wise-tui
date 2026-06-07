import { describe, expect, test } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  WORKSPACE_CONTEXT_REPOSITORY_ID,
  canEnterMultiPaneLayout,
  isWorkspaceContextRepository,
  resolveMultiPaneContextRepository,
} from "./multiPaneLayoutContext";

const repo = (id: number, path: string, name = `repo-${id}`): Repository => ({
  id,
  name,
  path,
  repositoryType: "frontend",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
});

describe("multiPaneLayoutContext", () => {
  test("canEnterMultiPaneLayout allows workspace focus without active repository", () => {
    const project: ProjectItem = {
      id: "p1",
      name: "eco",
      rootPath: "/work/eco",
      repositoryIds: [1],
      createdAt: 0,
      updatedAt: 0,
      sddMode: "wise_trellis",
    };
    const repositories = [repo(1, "/work/eco/eco-ai")];

    expect(
      canEnterMultiPaneLayout({
        activeRepository: null,
        activeProject: project,
        activeWorkspaceFocus: "project",
        activeSession: null,
        repositories,
      }),
    ).toBe(true);
  });

  test("resolveMultiPaneContextRepository prefers workspace explorer path in project focus", () => {
    const project: ProjectItem = {
      id: "p1",
      name: "eco",
      rootPath: "/work/eco",
      repositoryIds: [1],
      createdAt: 0,
      updatedAt: 0,
      sddMode: "wise_trellis",
    };
    const repositories = [repo(1, "/work/eco/eco-ai")];

    const resolved = resolveMultiPaneContextRepository({
      activeRepository: null,
      activeProject: project,
      activeWorkspaceFocus: "project",
      activeSession: null,
      repositories,
    });

    expect(resolved?.path).toBe("/work/eco");
    expect(resolved?.id).toBe(WORKSPACE_CONTEXT_REPOSITORY_ID);
    expect(isWorkspaceContextRepository(resolved)).toBe(true);
  });

  test("resolveMultiPaneContextRepository falls back to active session path", () => {
    const session = {
      id: "s1",
      repositoryPath: "/tmp/workspace-only",
      repositoryName: "workspace-only",
    } as ClaudeSession;

    const resolved = resolveMultiPaneContextRepository({
      activeRepository: null,
      activeProject: null,
      activeWorkspaceFocus: "repository",
      activeSession: session,
      repositories: [],
    });

    expect(resolved?.path).toBe("/tmp/workspace-only");
  });
});
