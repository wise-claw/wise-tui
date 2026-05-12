import type { EmployeeItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";

/**
 * 各仓库主 Owner：仅当员工「关联了该仓库」且 `agentType` 与仓库 `mainOwnerAgentName` 一致时，
 * 才计入该仓的主 Owner 员工（避免同名 agentType 的全局误匹配）。
 */
export function resolveMainOwnerEmployeeIdsForProjectRepositories(
  repositories: Array<Pick<Repository, "id" | "mainOwnerAgentName">>,
  employees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
): string[] {
  const ids = new Set<string>();
  for (const repo of repositories) {
    const agent = repo.mainOwnerAgentName?.trim();
    if (!agent) continue;
    for (const e of employees) {
      if (!e.enabled) continue;
      if (e.agentType?.trim() !== agent) continue;
      if (!Array.isArray(e.repositoryIds) || !e.repositoryIds.includes(repo.id)) continue;
      ids.add(e.id);
    }
  }
  return Array.from(ids);
}

/** 项目内：该员工在「已关联该员工」的仓库上，且被配置为主 Owner 的仓库目录名。 */
export function repositoryBasenamesWhereEmployeeIsConfiguredMainOwner(
  projectRepositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
  employee: Pick<EmployeeItem, "agentType" | "repositoryIds">,
): string[] {
  const agent = employee.agentType?.trim() ?? "";
  if (!agent) return [];
  return projectRepositories
    .filter(
      (r) =>
        r.mainOwnerAgentName?.trim() === agent &&
        Array.isArray(employee.repositoryIds) &&
        employee.repositoryIds.includes(r.id),
    )
    .map((r) => repositoryFolderBasename(r).trim())
    .filter((name) => name.length > 0);
}

/**
 * 已配置 `mainOwnerAgentName`，但没有任何「关联该仓 + agentType 一致」的启用员工时的展示缺口。
 */
export function listRepositoryMainOwnerDisplayGaps(
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
  employees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
): Array<{ repositoryId: number; repoLabel: string; agentName: string }> {
  const out: Array<{ repositoryId: number; repoLabel: string; agentName: string }> = [];
  for (const repo of repositories) {
    const agent = repo.mainOwnerAgentName?.trim();
    if (!agent) continue;
    const matched = employees.some(
      (e) =>
        e.enabled &&
        e.agentType?.trim() === agent &&
        Array.isArray(e.repositoryIds) &&
        e.repositoryIds.includes(repo.id),
    );
    if (matched) continue;
    const repoLabel = repositoryFolderBasename(repo).trim();
    if (!repoLabel) continue;
    out.push({ repositoryId: repo.id, repoLabel, agentName: agent });
  }
  return out;
}

/**
 * 在限定 `defaultRepositoryIds`（例如从需求面板按项目预填仓库）时，从表格中隐藏「纯仓库主 Owner 镜像」员工：
 * 关联仓库 ⊆ 限定集合，且每个已关联仓均配置了 `mainOwnerAgentName` 并与该员工 `agentType` 一致。
 */
export function shouldHideEmployeeAsMainOwnerMirrorInRepositoryScope(
  employee: Pick<EmployeeItem, "repositoryIds" | "agentType">,
  defaultRepositoryIds: number[],
  repositoriesById: Map<number, Pick<Repository, "mainOwnerAgentName">>,
): boolean {
  if (defaultRepositoryIds.length === 0) return false;
  const rids = employee.repositoryIds ?? [];
  if (rids.length === 0) return false;
  if (!rids.every((rid) => defaultRepositoryIds.includes(rid))) return false;
  const agent = employee.agentType?.trim() ?? "";
  if (!agent) return false;
  return rids.every((rid) => {
    const main = repositoriesById.get(rid)?.mainOwnerAgentName?.trim() ?? "";
    return main.length > 0 && main === agent;
  });
}

/**
 * 在限定 `defaultRepositoryIds`（例如项目内全部仓库 id）时，从表格隐藏「仅关联这些仓库」的员工
 *（仓库侧创建的配置）；不删除数据。需配合 `alwaysShowEmployeeIds` 保留项目显式关联成员。
 */
export function shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds(
  employee: Pick<EmployeeItem, "repositoryIds">,
  defaultRepositoryIds: number[],
): boolean {
  if (defaultRepositoryIds.length === 0) return false;
  const rids = employee.repositoryIds ?? [];
  if (rids.length === 0) return false;
  return rids.every((rid) => defaultRepositoryIds.includes(rid));
}

/**
 * 在 `scopeRepositoryIds` 限定的仓库中，该员工作为「主 Owner」配置的目录名列表
 *（`mainOwnerAgentName` 与 `agentType` 一致且 `repositoryIds` 含该仓）。
 */
export function repositoryOwnerBasenamesInScope(
  employee: Pick<EmployeeItem, "agentType" | "repositoryIds">,
  scopeRepositoryIds: number[],
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
): string[] {
  if (scopeRepositoryIds.length === 0) return [];
  const scopeSet = new Set(scopeRepositoryIds);
  const inScopeRepos = repositories.filter((r) => scopeSet.has(r.id));
  return repositoryBasenamesWhereEmployeeIsConfiguredMainOwner(inScopeRepos, employee);
}

export function isEmployeeRepositoryOwnerInScope(
  employee: Pick<EmployeeItem, "agentType" | "repositoryIds">,
  scopeRepositoryIds: number[],
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
): boolean {
  return repositoryOwnerBasenamesInScope(employee, scopeRepositoryIds, repositories).length > 0;
}

function enabledEmployeesWithAgentType(
  allEmployees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
  agent: string,
): Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">> {
  const a = agent.trim();
  if (!a) return [];
  return allEmployees.filter((e) => e.enabled && e.agentType?.trim() === a);
}

/**
 * 在 {@link repositoryOwnerBasenamesInScope} 基础上：若仓库仅写了 `mainOwnerAgentName`、
 * 没有任何启用员工在 `repositoryIds` 里关联该仓，但全局**恰好只有一名**启用员工的 `agentType`
 * 与该配置一致，则仍把该仓计为该员工的 Owner 展示（与 `listRepositoryMainOwnerDisplayGaps` 互补）。
 */
export function repositoryOwnerBasenamesInScopeRelaxed(
  employee: Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">,
  scopeRepositoryIds: number[],
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
  allEmployees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
): string[] {
  const strict = repositoryOwnerBasenamesInScope(employee, scopeRepositoryIds, repositories);
  if (strict.length > 0) return strict;

  const agent = employee.agentType?.trim() ?? "";
  if (!agent || !employee.enabled) return [];

  const basenames = new Set<string>();
  for (const rid of scopeRepositoryIds) {
    const r = repositories.find((x) => x.id === rid);
    if (!r) continue;
    const main = r.mainOwnerAgentName?.trim() ?? "";
    if (main !== agent) continue;

    const linkedToRepo = enabledEmployeesWithAgentType(allEmployees, main).filter((e) =>
      (e.repositoryIds ?? []).includes(rid),
    );
    if (linkedToRepo.length >= 1) {
      if (linkedToRepo.some((e) => e.id === employee.id)) {
        const label = repositoryFolderBasename(r).trim();
        if (label.length > 0) basenames.add(label);
      }
      continue;
    }

    const sameAgentEnabled = enabledEmployeesWithAgentType(allEmployees, main);
    if (sameAgentEnabled.length === 1 && sameAgentEnabled[0].id === employee.id) {
      const label = repositoryFolderBasename(r).trim();
      if (label.length > 0) basenames.add(label);
    }
  }
  return Array.from(basenames);
}

export function isEmployeeRepositoryOwnerInScopeRelaxed(
  employee: Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">,
  scopeRepositoryIds: number[],
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
  allEmployees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
): boolean {
  return (
    repositoryOwnerBasenamesInScopeRelaxed(employee, scopeRepositoryIds, repositories, allEmployees).length > 0
  );
}

/**
 * 是否已有员工在本表中会以「Owner 标识」展示该仓（严格或宽松推断）。
 * 用于避免「仓库主 Owner 缺口行」与已能展示的员工行重复。
 */
export function someEmployeeDisplaysMainOwnerForRepository(
  repositoryId: number,
  scopeRepositoryIds: number[],
  repositories: Array<Pick<Repository, "id" | "path" | "name" | "mainOwnerAgentName">>,
  allEmployees: Array<Pick<EmployeeItem, "id" | "agentType" | "enabled" | "repositoryIds">>,
): boolean {
  if (!scopeRepositoryIds.includes(repositoryId)) return false;
  const r = repositories.find((x) => x.id === repositoryId);
  const label = r ? repositoryFolderBasename(r).trim() : "";
  if (!label) return false;
  return allEmployees.some((e) => {
    const names = repositoryOwnerBasenamesInScopeRelaxed(e, scopeRepositoryIds, repositories, allEmployees);
    return names.includes(label);
  });
}
