import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { selectFloatingRepositories } from "./floatingRepositories";

function repo(id: number, path = `/r/${id}`): Repository {
  return {
    id,
    name: `repo-${id}`,
    path,
    repositoryType: "frontend",
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
    rootPath: input.rootPath,
    sddMode: input.sddMode,
  };
}

/**
 * 验证「添加游离 → 升格新项目 → 加入已有项目 → 移除」端到端的数据契约。
 *
 * 测试的是 `selectFloatingRepositories` 派生在每个生命周期阶段的输出；
 * useRepositoryList 内部 setState 路径需要 React 测试环境，这里只盯紧数据契约。
 */
describe("floating repo lifecycle", () => {
  test("add → promote to new project → join existing project → remove", () => {
    let projects: ProjectItem[] = [];
    let repositories: Repository[] = [];

    // 0) 初始空状态：无游离 repo
    expect(selectFloatingRepositories(projects, repositories)).toEqual([]);

    // 1) 添加游离仓库 r1：顶层游离区出现
    repositories = [repo(1)];
    expect(selectFloatingRepositories(projects, repositories).map((r) => r.id)).toEqual([1]);

    // 2) 升格 r1 为新项目 p1：r1 从游离区出栈
    projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(selectFloatingRepositories(projects, repositories)).toEqual([]);

    // 3) 再添加一个游离仓库 r2：顶层游离区只显示 r2
    repositories = [...repositories, repo(2)];
    expect(selectFloatingRepositories(projects, repositories).map((r) => r.id)).toEqual([2]);

    // 4) r2 加入现有项目 p1：r2 从游离区出栈，p1 持有 [1, 2]
    projects = projects.map((p) =>
      p.id === "p1" ? { ...p, repositoryIds: [...p.repositoryIds, 2] } : p,
    );
    expect(selectFloatingRepositories(projects, repositories)).toEqual([]);
    expect(projects[0].repositoryIds).toEqual([1, 2]);

    // 5) 全局删除 r2（同步从所属项目移除）：游离区仍为空，p1 退化到 [1]
    repositories = repositories.filter((r) => r.id !== 2);
    projects = projects.map((p) => ({
      ...p,
      repositoryIds: p.repositoryIds.filter((id) => id !== 2),
    }));
    expect(selectFloatingRepositories(projects, repositories)).toEqual([]);
    expect(projects[0].repositoryIds).toEqual([1]);
  });

  test("delete floating repo without project association keeps lifecycle local", () => {
    let projects: ProjectItem[] = [project({ id: "p1", repositoryIds: [10] })];
    let repositories: Repository[] = [repo(10), repo(20)];

    // 起始：r20 游离、r10 在 p1
    expect(selectFloatingRepositories(projects, repositories).map((r) => r.id)).toEqual([20]);

    // 删除游离 r20：游离区清空，p1 不受影响
    repositories = repositories.filter((r) => r.id !== 20);
    projects = projects.map((p) => ({
      ...p,
      repositoryIds: p.repositoryIds.filter((id) => repositories.some((r) => r.id === id)),
    }));
    expect(selectFloatingRepositories(projects, repositories)).toEqual([]);
    expect(projects[0].repositoryIds).toEqual([10]);
  });

  test("promote-to-project keeps order stable: floating before project after promotion", () => {
    let projects: ProjectItem[] = [];
    let repositories: Repository[] = [repo(1), repo(2), repo(3)];

    // 三个全部游离
    expect(selectFloatingRepositories(projects, repositories).map((r) => r.id)).toEqual([
      1, 2, 3,
    ]);

    // r2 升格：仅 r1 / r3 仍游离，输入顺序保留
    projects = [project({ id: "p2", repositoryIds: [2] })];
    expect(selectFloatingRepositories(projects, repositories).map((r) => r.id)).toEqual([
      1, 3,
    ]);
  });
});
