import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { useLayoutEffect, useState } from "react";
import type { ProjectItem } from "../../types";
import { useProjectRepositorySidebarState } from "./useProjectRepositorySidebarState";

function project(id: string, name = id): ProjectItem {
  return {
    id,
    name,
    repositoryIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

type Api = ReturnType<typeof useProjectRepositorySidebarState>;

interface Harness {
  get api(): Api;
  setProjects(next: ProjectItem[]): void;
  unmount(): void;
}

function makeHarness(initialProjects: ProjectItem[]): Harness {
  let api: Api | null = null;
  const setterRef: { current: ((next: ProjectItem[]) => void) | null } = { current: null };
  let renderer: ReturnType<typeof create> | undefined;

  function Probe() {
    const [projects, setProjects] = useState(initialProjects);
    setterRef.current = setProjects;
    const result = useProjectRepositorySidebarState({
      projects,
      repositories: [],
      activeProjectId: null,
      activeRepositoryId: null,
    });
    useLayoutEffect(() => {
      api = result;
    });
    return null;
  }

  act(() => {
    renderer = create(<Probe />);
  });
  if (!api) throw new Error("Probe never received api");
  if (!setterRef.current) throw new Error("setter not ready");

  return {
    get api() {
      if (!api) throw new Error("api not ready");
      return api;
    },
    setProjects: (next) => {
      if (!setterRef.current) throw new Error("setter not ready");
      act(() => {
        setterRef.current?.(next);
      });
    },
    unmount: () => renderer?.unmount(),
  };
}

describe("useProjectRepositorySidebarState", () => {
  test("初始加载：全部工作区默认展开", () => {
    const harness = makeHarness([project("p1"), project("p2"), project("p3")]);
    expect(harness.api.expandedProjects.has("p1")).toBe(true);
    expect(harness.api.expandedProjects.has("p2")).toBe(true);
    expect(harness.api.expandedProjects.has("p3")).toBe(true);
    harness.unmount();
  });

  test("异步加载项目列表：加载后全部展开", () => {
    const harness = makeHarness([]);
    expect(harness.api.expandedProjects.size).toBe(0);

    harness.setProjects([project("a"), project("b")]);
    expect(harness.api.expandedProjects.has("a")).toBe(true);
    expect(harness.api.expandedProjects.has("b")).toBe(true);
    harness.unmount();
  });

  test("新建工作区自动展开，已收起的工作区保持收起", () => {
    const harness = makeHarness([project("p1"), project("p2")]);
    act(() => {
      harness.api.toggleProjectExpand("p2");
    });
    expect(harness.api.expandedProjects.has("p2")).toBe(false);

    harness.setProjects([project("p1"), project("p2"), project("p3")]);
    expect(harness.api.expandedProjects.has("p1")).toBe(true);
    expect(harness.api.expandedProjects.has("p2")).toBe(false);
    expect(harness.api.expandedProjects.has("p3")).toBe(true);
    harness.unmount();
  });

  test("删除工作区后从 expanded 集合 prune", () => {
    const harness = makeHarness([project("p1"), project("p2")]);
    harness.setProjects([project("p1")]);
    expect(harness.api.expandedProjects.has("p1")).toBe(true);
    expect(harness.api.expandedProjects.has("p2")).toBe(false);
    harness.unmount();
  });
});
