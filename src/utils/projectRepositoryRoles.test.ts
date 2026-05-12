import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  getEffectiveRepoSddMode,
  getProjectSddMode,
  getRoleTags,
} from "./projectRepositoryRoles";

function repo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: "demo",
    path: "/repo/demo",
    repositoryType: "frontend",
    createdAt: "0",
    updatedAt: "0",
    ...overrides,
  };
}

function project(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: "p1",
    name: "Demo",
    repositoryIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("getRoleTags", () => {
  test("returns explicit roleTags when non-empty", () => {
    expect(getRoleTags(repo({ roleTags: ["frontend", "test"] }))).toEqual(["frontend", "test"]);
  });

  test("trims and filters empty entries", () => {
    expect(getRoleTags(repo({ roleTags: ["  frontend  ", "", "  "] }))).toEqual(["frontend"]);
  });

  test("falls back to [repositoryType] when roleTags missing", () => {
    expect(getRoleTags(repo({ repositoryType: "backend" }))).toEqual(["backend"]);
  });

  test("falls back to [repositoryType] when roleTags empty array", () => {
    expect(getRoleTags(repo({ repositoryType: "backend", roleTags: [] }))).toEqual(["backend"]);
  });

  test("returns empty array when neither set", () => {
    const r = repo();
    delete (r as Partial<Repository>).repositoryType;
    expect(getRoleTags(r as Repository)).toEqual([]);
  });
});

describe("getEffectiveRepoSddMode", () => {
  test("returns owning project's sddMode", () => {
    const r = repo({ id: 7 });
    const p = project({ repositoryIds: [7], sddMode: "project_owned" });
    expect(getEffectiveRepoSddMode(r, [p])).toBe("project_owned");
  });

  test("defaults to wise_trellis when repo is in a project without sddMode", () => {
    const r = repo({ id: 7 });
    const p = project({ repositoryIds: [7] });
    expect(getEffectiveRepoSddMode(r, [p])).toBe("wise_trellis");
  });

  test("legacy fallback: repo.sddMode=wise_trellis without owning project", () => {
    const r = repo({ id: 7, sddMode: "wise_trellis" });
    expect(getEffectiveRepoSddMode(r, [])).toBe("wise_trellis");
  });

  test("legacy fallback: repo.sddMode=off coerces to project_owned", () => {
    const r = repo({ id: 7, sddMode: "off" });
    expect(getEffectiveRepoSddMode(r, [])).toBe("project_owned");
  });

  test("defaults to wise_trellis when no signal", () => {
    const r = repo({ id: 7 });
    expect(getEffectiveRepoSddMode(r, [])).toBe("wise_trellis");
  });

  test("picks the first matching project when repo is in multiple", () => {
    const r = repo({ id: 7 });
    const a = project({ id: "a", repositoryIds: [7], sddMode: "project_owned" });
    const b = project({ id: "b", repositoryIds: [7], sddMode: "wise_trellis" });
    expect(getEffectiveRepoSddMode(r, [a, b])).toBe("project_owned");
  });
});

describe("getProjectSddMode", () => {
  test("returns explicit value", () => {
    expect(getProjectSddMode(project({ sddMode: "project_owned" }))).toBe("project_owned");
  });

  test("defaults to wise_trellis when missing", () => {
    expect(getProjectSddMode(project())).toBe("wise_trellis");
  });

  test("handles null/undefined inputs", () => {
    expect(getProjectSddMode(null)).toBe("wise_trellis");
    expect(getProjectSddMode(undefined)).toBe("wise_trellis");
  });
});
