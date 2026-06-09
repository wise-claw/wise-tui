import { describe, expect, test } from "bun:test";
import { areLeftSidebarPropsEqual } from "./leftSidebarPropsEqual";
import type { LeftSidebarProps } from "./types";

function baseProps(overrides: Partial<LeftSidebarProps> = {}): LeftSidebarProps {
  return {
    dark: false,
    collapsed: false,
    projects: [],
    activeProjectId: null,
    repositories: [],
    activeRepositoryId: null,
    onOpenAuthor: () => undefined,
    onProjectSelect: () => undefined,
    onCreateProject: () => undefined,
    onUpdateProject: () => undefined,
    onDeleteProject: () => undefined,
    pinnedProjectIds: [],
    onTogglePinProject: () => undefined,
    onDetachRepositoryFromProject: () => undefined,
    sessions: [],
    sessionsStructureKey: "n:0",
    sessionsLiveRef: { current: [] },
    repositoryMainSessionBindings: {},
    activeSessionId: null,
    onSelectSession: () => undefined,
    ...overrides,
  };
}

describe("areLeftSidebarPropsEqual", () => {
  test("ignores sessions reference when structure key matches", () => {
    const shared = baseProps();
    const prev = { ...shared, sessions: [{ id: "a" } as LeftSidebarProps["sessions"][number]] };
    const next = { ...shared, sessions: [{ id: "b" } as LeftSidebarProps["sessions"][number]] };
    expect(areLeftSidebarPropsEqual(prev, next)).toBe(true);
  });

  test("detects structure key changes", () => {
    const prev = baseProps({ sessionsStructureKey: "n:0" });
    const next = baseProps({ sessionsStructureKey: "n:1" });
    expect(areLeftSidebarPropsEqual(prev, next)).toBe(false);
  });
});
