/**
 * Cluster planner — 把 requirements-index 与项目下的仓库列表分桶为可独立派 splitter
 * 的 cluster。纯函数；不调用 LLM，不依赖 Tauri。
 *
 * 规则：
 *   1. 单仓 → 单 cluster，覆盖全部 requirements。
 *   2. 多仓 → 按 requirement 文本对仓位名 / basename / 类型关键词的匹配度评分，最高分赢家
 *      获得该 requirement；分数为 0 的回退到「按多数类型选首仓」；并列分数计入 cross-repo。
 *   3. 每个 cluster 超过 `maxRequirementsPerCluster` 时按 requirementId 顺序二切。
 *   4. `knownRepoDependencies` 映射到 cluster 间 `dependencyClusterIds`。
 */

import type { Repository } from "../../types";

export interface PlannerRepo {
  id: number;
  name: string;
  type: Repository["repositoryType"];
  path: string;
}

export interface PlannerRequirement {
  id: string;
  content: string;
}

export interface PlannerKnownDependency {
  fromRepoId: number;
  toRepoId: number;
}

export interface PlannerOptions {
  maxRequirementsPerCluster?: number;
  /** requirementId → repoId，AI 生成的仓库分配，存在时跳过关键词匹配 */
  repoAssignments?: Record<string, number>;
}

export interface ClusterPlanItem {
  id: string;
  title: string;
  primaryRepositoryId: number | null;
  repositoryIds: number[];
  requirementIds: string[];
  dependencyClusterIds: string[];
}

export interface ClusterPlan {
  clusters: ClusterPlanItem[];
  diagnostics: {
    requirementsCoverage: { covered: string[]; orphan: string[] };
    crossRepoRequirements: string[];
  };
}

const DEFAULT_MAX_REQUIREMENTS_PER_CLUSTER = 24;

const REPO_TYPE_KEYWORDS: Record<Repository["repositoryType"], string[]> = {
  frontend: [
    "前端", "UI", "页面", "组件", "界面", "样式", "frontend", "client", "browser",
    "react", "vue", "tauri", "antd", "tsx", "css",
  ],
  backend: [
    "后端", "接口", "服务", "API", "rpc", "数据库", "table", "schema",
    "backend", "server", "rust", "python", "go", "node", "endpoint",
  ],
  document: [
    "文档", "说明", "指南", "手册", "教程", "spec", "docs", "readme",
  ],
};

/** 顶层入口。 */
export function planClusters(input: {
  repositories: PlannerRepo[];
  requirements: PlannerRequirement[];
  knownRepoDependencies?: PlannerKnownDependency[];
  options?: PlannerOptions;
}): ClusterPlan {
  const maxPerCluster =
    input.options?.maxRequirementsPerCluster ?? DEFAULT_MAX_REQUIREMENTS_PER_CLUSTER;
  const assignments = input.options?.repoAssignments;

  if (input.requirements.length === 0) {
    return emptyPlan();
  }

  if (input.repositories.length === 0) {
    return planOrphanOnly(input.requirements);
  }

  // AI 分配优先于关键词匹配
  if (assignments && Object.keys(assignments).length > 0) {
    return planWithAssignments(input.repositories, input.requirements, assignments, maxPerCluster);
  }

  if (input.repositories.length === 1) {
    return planSingleRepo(input.repositories[0], input.requirements, maxPerCluster);
  }

  return planMultiRepo(input, maxPerCluster);
}

function planWithAssignments(
  repos: PlannerRepo[],
  requirements: PlannerRequirement[],
  assignments: Record<string, number>,
  maxPerCluster: number,
): ClusterPlan {
  const repoById = new Map(repos.map((r) => [r.id, r]));
  const buckets = new Map<number, string[]>();
  for (const repo of repos) buckets.set(repo.id, []);

  for (const req of requirements) {
    const repoId = assignments[req.id];
    if (repoId != null && repoById.has(repoId)) {
      appendRequirement(buckets, repoId, req.id);
    } else {
      // 回退到关键词匹配
      const scored = scoreRequirement(req, repos);
      const top = scored[0];
      const target = top && top.score > 0 ? top.repoId : pickFallbackRepoId(repos);
      appendRequirement(buckets, target, req.id);
    }
  }

  const clusters: ClusterPlanItem[] = [];
  for (const repo of repos) {
    const reqIds = buckets.get(repo.id) ?? [];
    if (reqIds.length === 0) continue;
    const chunks = splitBySize(reqIds, maxPerCluster);
    chunks.forEach((chunk, idx) => {
      clusters.push(buildCluster(repo, idx, chunk, chunks.length));
    });
  }

  return {
    clusters,
    diagnostics: {
      requirementsCoverage: { covered: requirements.map((r) => r.id), orphan: [] },
      crossRepoRequirements: [],
    },
  };
}

function emptyPlan(): ClusterPlan {
  return {
    clusters: [],
    diagnostics: {
      requirementsCoverage: { covered: [], orphan: [] },
      crossRepoRequirements: [],
    },
  };
}

function planOrphanOnly(requirements: PlannerRequirement[]): ClusterPlan {
  const cluster: ClusterPlanItem = {
    id: "cluster-orphan",
    title: "未关联仓库",
    primaryRepositoryId: null,
    repositoryIds: [],
    requirementIds: requirements.map((r) => r.id),
    dependencyClusterIds: [],
  };
  return {
    clusters: [cluster],
    diagnostics: {
      requirementsCoverage: {
        covered: [],
        orphan: requirements.map((r) => r.id),
      },
      crossRepoRequirements: [],
    },
  };
}

function planSingleRepo(
  repo: PlannerRepo,
  requirements: PlannerRequirement[],
  maxPerCluster: number,
): ClusterPlan {
  const buckets = splitBySize(requirements.map((r) => r.id), maxPerCluster);
  const clusters: ClusterPlanItem[] = buckets.map((reqIds, index) =>
    buildCluster(repo, index, reqIds, buckets.length),
  );
  return {
    clusters,
    diagnostics: {
      requirementsCoverage: {
        covered: requirements.map((r) => r.id),
        orphan: [],
      },
      crossRepoRequirements: [],
    },
  };
}

function planMultiRepo(
  input: {
    repositories: PlannerRepo[];
    requirements: PlannerRequirement[];
    knownRepoDependencies?: PlannerKnownDependency[];
  },
  maxPerCluster: number,
): ClusterPlan {
  const crossRepo: string[] = [];
  const buckets = new Map<number, string[]>();
  for (const repo of input.repositories) buckets.set(repo.id, []);

  for (const req of input.requirements) {
    const scored = scoreRequirement(req, input.repositories);
    const top = scored[0];
    const second = scored[1];
    if (top && second && top.score > 0 && top.score === second.score) {
      crossRepo.push(req.id);
    }
    const target = top && top.score > 0 ? top.repoId : pickFallbackRepoId(input.repositories);
    appendRequirement(buckets, target, req.id);
  }

  const clusters: ClusterPlanItem[] = [];
  for (const repo of input.repositories) {
    const reqIds = buckets.get(repo.id) ?? [];
    if (reqIds.length === 0) continue;
    const chunks = splitBySize(reqIds, maxPerCluster);
    chunks.forEach((chunk, idx) => {
      clusters.push(buildCluster(repo, idx, chunk, chunks.length));
    });
  }

  applyDependencyEdges(clusters, input.knownRepoDependencies ?? []);

  return {
    clusters,
    diagnostics: {
      requirementsCoverage: {
        covered: input.requirements.map((r) => r.id),
        orphan: [],
      },
      crossRepoRequirements: [...new Set(crossRepo)],
    },
  };
}

interface RequirementScore {
  repoId: number;
  score: number;
}

function scoreRequirement(req: PlannerRequirement, repos: PlannerRepo[]): RequirementScore[] {
  const haystack = req.content.toLowerCase();
  const scored: RequirementScore[] = repos.map((repo) => ({
    repoId: repo.id,
    score: computeRepoScore(haystack, repo),
  }));
  scored.sort((a, b) => b.score - a.score || a.repoId - b.repoId);
  return scored;
}

function computeRepoScore(haystack: string, repo: PlannerRepo): number {
  let score = 0;
  const name = repo.name.toLowerCase().trim();
  if (name && haystack.includes(name)) score += 3;
  const basename = pathBasename(repo.path).toLowerCase();
  if (basename && basename !== name && haystack.includes(basename)) score += 2;
  const keywords = REPO_TYPE_KEYWORDS[repo.type] ?? [];
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += 1;
      break;
    }
  }
  return score;
}

function pathBasename(p: string): string {
  const raw = p.trim().replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function pickFallbackRepoId(repos: PlannerRepo[]): number {
  // 类型计数最多者获胜；并列时返回 id 最小者（确定性）。
  const counts = new Map<Repository["repositoryType"], number>();
  for (const repo of repos) counts.set(repo.type, (counts.get(repo.type) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const majorityType = sorted[0][0];
  const candidates = repos.filter((r) => r.type === majorityType);
  return candidates.sort((a, b) => a.id - b.id)[0].id;
}

function appendRequirement(buckets: Map<number, string[]>, repoId: number, reqId: string): void {
  const arr = buckets.get(repoId);
  if (arr) arr.push(reqId);
}

function splitBySize(values: string[], size: number): string[][] {
  if (size <= 0) return values.length > 0 ? [values] : [];
  const buckets: string[][] = [];
  for (let i = 0; i < values.length; i += size) {
    buckets.push(values.slice(i, i + size));
  }
  return buckets.length > 0 ? buckets : [[]];
}

function buildCluster(
  repo: PlannerRepo,
  shardIndex: number,
  requirementIds: string[],
  shardCount: number,
): ClusterPlanItem {
  const shardSuffix = shardCount > 1 ? `-${shardIndex + 1}` : "";
  const id = `cluster-${repo.type}-${repo.id}${shardSuffix}`;
  const title =
    shardCount > 1
      ? `${repo.name} · 分片 ${shardIndex + 1}/${shardCount}`
      : repo.name;
  return {
    id,
    title,
    primaryRepositoryId: repo.id,
    repositoryIds: [repo.id],
    requirementIds,
    dependencyClusterIds: [],
  };
}

function applyDependencyEdges(
  clusters: ClusterPlanItem[],
  edges: PlannerKnownDependency[],
): void {
  if (edges.length === 0) return;
  const clustersByRepoId = new Map<number, ClusterPlanItem[]>();
  for (const c of clusters) {
    if (c.primaryRepositoryId == null) continue;
    const list = clustersByRepoId.get(c.primaryRepositoryId) ?? [];
    list.push(c);
    clustersByRepoId.set(c.primaryRepositoryId, list);
  }
  for (const edge of edges) {
    const sources = clustersByRepoId.get(edge.fromRepoId) ?? [];
    const targets = clustersByRepoId.get(edge.toRepoId) ?? [];
    if (sources.length === 0 || targets.length === 0) continue;
    for (const src of sources) {
      for (const dst of targets) {
        if (!src.dependencyClusterIds.includes(dst.id)) {
          src.dependencyClusterIds.push(dst.id);
        }
      }
    }
  }
}
