import { describe, expect, test } from "bun:test";
import {
  extractPlannerFeedbackHints,
  normalizePlannerRepoAssignments,
  planClusters,
  type PlannerRepo,
  type PlannerRequirement,
} from "./clusterPlanner";

const REPO_FE: PlannerRepo = { id: 1, name: "web", type: "frontend", path: "/abs/web" };
const REPO_BE: PlannerRepo = { id: 2, name: "api", type: "backend", path: "/abs/api" };
const REPO_DOC: PlannerRepo = { id: 3, name: "docs", type: "document", path: "/abs/docs" };

function reqs(items: Array<[string, string]>): PlannerRequirement[] {
  return items.map(([id, content]) => ({ id, content }));
}

describe("planClusters — degenerate inputs", () => {
  test("empty requirements produce empty plan", () => {
    const plan = planClusters({ repositories: [REPO_FE], requirements: [] });
    expect(plan.clusters).toEqual([]);
    expect(plan.diagnostics.requirementsCoverage.covered).toEqual([]);
  });

  test("no repositories collapse to single orphan cluster", () => {
    const plan = planClusters({
      repositories: [],
      requirements: reqs([
        ["r1", "anything"],
        ["r2", "anything else"],
      ]),
    });
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0].primaryRepositoryId).toBeNull();
    expect(plan.diagnostics.requirementsCoverage.orphan).toEqual(["r1", "r2"]);
  });
});

describe("planClusters — single repo", () => {
  test("groups all requirements into one cluster", () => {
    const plan = planClusters({
      repositories: [REPO_FE],
      requirements: reqs([
        ["r1", "login page"],
        ["r2", "anything"],
      ]),
    });
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0].primaryRepositoryId).toBe(1);
    expect(plan.clusters[0].requirementIds).toEqual(["r1", "r2"]);
  });

  test("shards when size cap exceeded", () => {
    const big = reqs(
      Array.from({ length: 30 }, (_, i) => [`r${i + 1}`, "content"] as [string, string]),
    );
    const plan = planClusters({
      repositories: [REPO_FE],
      requirements: big,
      options: { maxRequirementsPerCluster: 10 },
    });
    expect(plan.clusters).toHaveLength(3);
    expect(plan.clusters[0].id).toBe("cluster-frontend-1-1");
    expect(plan.clusters[0].title).toBe("web · 分片 1/3");
    expect(plan.clusters[2].requirementIds).toHaveLength(10);
  });
});

describe("planClusters — multi-repo", () => {
  test("routes by repo name match", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE],
      requirements: reqs([
        ["r1", "更新 web 页面登录态"],
        ["r2", "api 增加签发接口"],
      ]),
    });
    const feCluster = plan.clusters.find((c) => c.primaryRepositoryId === 1);
    const beCluster = plan.clusters.find((c) => c.primaryRepositoryId === 2);
    expect(feCluster?.requirementIds).toEqual(["r1"]);
    expect(beCluster?.requirementIds).toEqual(["r2"]);
    expect(plan.diagnostics.crossRepoRequirements).toEqual([]);
  });

  test("routes by type keywords when name absent", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE],
      requirements: reqs([
        ["r1", "新增前端登录页面与表单校验"],
        ["r2", "后端 RPC 接口与数据库 schema"],
      ]),
    });
    expect(plan.clusters.find((c) => c.primaryRepositoryId === 1)?.requirementIds).toEqual(["r1"]);
    expect(plan.clusters.find((c) => c.primaryRepositoryId === 2)?.requirementIds).toEqual(["r2"]);
  });

  test("tied scores produce cross-repo diagnostic", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE],
      requirements: reqs([
        ["r1", "前端和后端联调登录态"], // 触发 frontend 关键词 + backend 关键词 各 1 分
      ]),
    });
    expect(plan.diagnostics.crossRepoRequirements).toContain("r1");
  });

  test("zero-signal falls back to majority type's first repo", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE, REPO_DOC],
      requirements: reqs([["r1", "Lorem ipsum dolor sit amet"]]),
    });
    // 三种类型各 1，tie → 取计数最大的中 id 最小者 → 这里全是 1 vs 1 vs 1
    // 实现中 sort 取第一项；以 frontend(id=1) 为 fallback。
    const target = plan.clusters[0];
    expect(target.primaryRepositoryId).toBe(1);
  });

  test("applies known repo dependency to cluster edges", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE],
      requirements: reqs([
        ["r1", "web 登录"],
        ["r2", "api 接口"],
      ]),
      knownRepoDependencies: [{ fromRepoId: 1, toRepoId: 2 }],
    });
    const fe = plan.clusters.find((c) => c.primaryRepositoryId === 1)!;
    const be = plan.clusters.find((c) => c.primaryRepositoryId === 2)!;
    expect(fe.dependencyClusterIds).toEqual([be.id]);
    expect(be.dependencyClusterIds).toEqual([]);
  });

  test("empty repos in plan are omitted", () => {
    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE, REPO_DOC],
      requirements: reqs([
        ["r1", "web 首页"],
        ["r2", "web 注册"],
      ]),
    });
    expect(plan.clusters.map((c) => c.primaryRepositoryId)).toEqual([1]);
  });
});

describe("planClusters — feedback hints", () => {
  test("routes only current requirement ids when feedback anchor hash matches", () => {
    const feedback = [
      "### Requirement To Task Anchors",
      "",
      "| Cluster | Task | Trellis task | Requirements | Anchor |",
      "| --- | --- | --- | --- | --- |",
      "| cluster-backend-2 | API | .trellis/tasks/p/api | req-functional-1, req-functional-old | aaaaaaaaaaaaaaaa [0, 12] |",
    ].join("\n");
    const requirements = [
      { id: "req-functional-1", content: "新增登录 API", bodyHash: "aaaaaaaaaaaaaaaa" },
      { id: "req-functional-2", content: "新增前端页面", bodyHash: "bbbbbbbbbbbbbbbb" },
    ];
    const feedbackHints = extractPlannerFeedbackHints({
      feedback,
      repositories: [REPO_FE, REPO_BE],
      requirements,
    });

    const plan = planClusters({
      repositories: [REPO_FE, REPO_BE],
      requirements,
      options: { feedbackHints },
    });

    expect(feedbackHints.repoAssignments).toEqual({ "req-functional-1": 2 });
    expect(plan.clusters.find((c) => c.primaryRepositoryId === 2)?.requirementIds).toEqual(["req-functional-1"]);
    expect(plan.clusters.flatMap((c) => c.requirementIds)).not.toContain("req-functional-old");
  });

  test("ignores feedback when requirement body hash changed", () => {
    const feedback = [
      "| Cluster | Task | Trellis task | Requirements | Anchor |",
      "| --- | --- | --- | --- | --- |",
      "| cluster-backend-2 | API | .trellis/tasks/p/api | req-functional-1 | aaaaaaaaaaaaaaaa [0, 12] |",
    ].join("\n");
    const requirements = [
      { id: "req-functional-1", content: "新增前端页面", bodyHash: "bbbbbbbbbbbbbbbb" },
    ];
    const feedbackHints = extractPlannerFeedbackHints({
      feedback,
      repositories: [REPO_FE, REPO_BE],
      requirements,
    });

    expect(feedbackHints.repoAssignments).toEqual({});
  });

  test("normalizes AI assignments to current requirement and repo ids", () => {
    const normalized = normalizePlannerRepoAssignments(
      {
        "req-functional-1": "2",
        "req-functional-old": 2,
        "req-functional-2": 99,
        "req-functional-3": "backend",
      },
      [
        { id: "req-functional-1", content: "API" },
        { id: "req-functional-2", content: "UI" },
        { id: "req-functional-3", content: "Docs" },
      ],
      [REPO_FE, REPO_BE],
    );

    expect(normalized).toEqual({ "req-functional-1": 2 });
  });
});
