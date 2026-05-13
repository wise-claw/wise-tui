import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { buildProjectRoleTagOptions } from "./projectRoleTagOptions";

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

describe("buildProjectRoleTagOptions", () => {
  test("aggregates tags across member repos", () => {
    const p = project({ id: "p", repositoryIds: [1, 2] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/web", name: "web", roleTags: ["frontend"] }),
      repo({ id: 2, path: "/p/api", name: "api", roleTags: ["backend", "shared"] }),
    ]);
    const tags = opts.map((o) => o.tag).sort();
    expect(tags).toEqual(["backend", "frontend", "shared"]);
    expect(opts.find((item) => item.tag === "frontend")).toEqual({
      tag: "frontend",
      label: "frontend",
      description: "匹配 1 个仓库: web",
      repoCount: 1,
      repoNames: ["web"],
    });
  });

  test("dedups case-insensitively keeping first-seen casing", () => {
    const p = project({ id: "p", repositoryIds: [1, 2] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/a", name: "a", roleTags: ["Frontend"] }),
      repo({ id: 2, path: "/p/b", name: "b", roleTags: ["frontend"] }),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]?.tag).toBe("Frontend");
    expect(opts[0]?.repoCount).toBe(2);
  });

  test("sorted by repoCount desc, then alpha asc", () => {
    const p = project({ id: "p", repositoryIds: [1, 2, 3] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/x", name: "x", roleTags: ["frontend", "shared"] }),
      repo({ id: 2, path: "/p/y", name: "y", roleTags: ["frontend"] }),
      repo({ id: 3, path: "/p/z", name: "z", roleTags: ["backend"] }),
    ]);
    expect(opts.map((o) => o.tag)).toEqual(["frontend", "backend", "shared"]);
  });

  test("falls back to legacy repositoryType via getRoleTags", () => {
    const p = project({ id: "p", repositoryIds: [1] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/doc", name: "doc", repositoryType: "document" }),
    ]);
    expect(opts.map((o) => o.tag)).toEqual(["document"]);
  });

  test("returns [] when project is null/undefined", () => {
    expect(buildProjectRoleTagOptions(null, [])).toEqual([]);
    expect(buildProjectRoleTagOptions(undefined, [])).toEqual([]);
  });

  test("returns [] when project has no member repos", () => {
    const p = project({ id: "p", repositoryIds: [] });
    expect(buildProjectRoleTagOptions(p, [repo({ id: 1, path: "/x" })])).toEqual([]);
  });

  test("empty/whitespace tags are filtered", () => {
    const p = project({ id: "p", repositoryIds: [1] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/a", name: "a", roleTags: ["", "  ", "frontend"] }),
    ]);
    expect(opts.map((o) => o.tag)).toEqual(["frontend"]);
  });

  test("description keeps repo names in input order", () => {
    const p = project({ id: "p", repositoryIds: [1, 2, 3, 4, 5] });
    const opts = buildProjectRoleTagOptions(
      p,
      [1, 2, 3, 4, 5].map((id) =>
        repo({ id, path: `/p/r${id}`, name: `r${id}`, roleTags: ["shared"] }),
      ),
    );
    expect(opts).toHaveLength(1);
    expect(opts[0]?.description).toBe("匹配 5 个仓库: r1, r2, r3, r4, r5");
    expect(opts[0]?.repoNames).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  test("repo not in repositoryIds is ignored even if id collides", () => {
    const p = project({ id: "p", repositoryIds: [1] });
    const opts = buildProjectRoleTagOptions(p, [
      repo({ id: 1, path: "/p/a", name: "a", roleTags: ["frontend"] }),
      repo({ id: 99, path: "/other", name: "other", roleTags: ["mobile"] }),
    ]);
    expect(opts.map((o) => o.tag)).toEqual(["frontend"]);
  });

  test("caps options at 32 entries after sorting", () => {
    const repositoryIds = Array.from({ length: 40 }, (_, index) => index + 1);
    const p = project({ id: "p", repositoryIds });
    const opts = buildProjectRoleTagOptions(
      p,
      repositoryIds.map((id) =>
        repo({
          id,
          path: `/p/r${id}`,
          name: `r${id}`,
          roleTags: [`tag-${String(id).padStart(2, "0")}`],
        }),
      ),
    );
    expect(opts).toHaveLength(32);
    expect(opts[0]?.tag).toBe("tag-01");
    expect(opts[31]?.tag).toBe("tag-32");
  });
});
