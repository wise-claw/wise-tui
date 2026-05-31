import { normalizeSessionExecutionEngine, type SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { EmployeeItem, Repository } from "../types";
import { isProjectRootSessionDisplayName, normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";

type ClaudeSessionLike = {
  repositoryPath: string;
  repositoryName: string;
};

/** 与 ClaudeChat composer 一致的会话所属仓库（侧栏选中或路径匹配）。 */
export function resolveChatContextRepository(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  activeRepository?: Repository | null,
): Repository | null {
  if (activeRepository) return activeRepository;
  const pathKey = normalizeRepositoryPathKey(session.repositoryPath ?? "");
  return repositories.find((item) => normalizeRepositoryPathKey(item.path) === pathKey) ?? null;
}

/** 派发路径与 Composer 展示使用同一套仓库/引擎解析，避免 UI 为 Cursor 却仍 spawn Claude。 */
export function resolveEngineForSession(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
  activeRepository?: Repository | null,
): SessionExecutionEngine {
  const chatRepo = resolveChatContextRepository(session, repositories, activeRepository);
  return resolveSessionExecutionEngine(session, repositories, employees, chatRepo);
}

export function resolveRepositoryPathForSessionExecution(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
  activeRepository?: Repository | null,
): string {
  const chatRepo = resolveChatContextRepository(session, repositories, activeRepository);
  return resolveExecutionRepositoryPath(session, repositories, employees, chatRepo);
}

/** 解析执行引擎配置应写入/读取的仓库（成员会话返回 null，走员工配置）。 */
export function resolveExecutionEngineRepository(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
  activeRepository?: Repository | null,
): Repository | null {
  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (employeeName) {
    const match = employees.find(
      (employee) => employee.enabled && employee.name.trim() === employeeName.trim(),
    );
    if (match) return null;
  }

  const pathKey = normalizeRepositoryPathKey(session.repositoryPath ?? "");
  const byPath = repositories.find((item) => normalizeRepositoryPathKey(item.path) === pathKey);
  if (byPath) return byPath;

  const namePrefix = session.repositoryName.split("/")[0]?.trim() ?? "";
  if (namePrefix && !isProjectRootSessionDisplayName(namePrefix)) {
    const byName = repositories.find((item) => item.name.trim() === namePrefix);
    if (byName) return byName;
  }

  if (activeRepository) return activeRepository;

  return null;
}

export function resolveSessionExecutionEngine(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
  activeRepository?: Repository | null,
): SessionExecutionEngine {
  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (employeeName) {
    const match = employees.find(
      (employee) => employee.enabled && employee.name.trim() === employeeName.trim(),
    );
    if (match) {
      return normalizeSessionExecutionEngine(match.executionEngine);
    }
  }

  const repo = resolveExecutionEngineRepository(session, repositories, employees, activeRepository);
  return normalizeSessionExecutionEngine(repo?.executionEngine);
}

/** Cursor/Codex 执行 cwd：优先匹配 session 路径的仓库，否则回退 activeRepository。 */
export function resolveExecutionRepositoryPath(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
  activeRepository?: Repository | null,
): string {
  const pathKey = normalizeRepositoryPathKey(session.repositoryPath ?? "");
  const byPath = repositories.find((item) => normalizeRepositoryPathKey(item.path) === pathKey);
  if (byPath?.path?.trim()) return byPath.path.trim();

  const repo = resolveExecutionEngineRepository(session, repositories, employees, activeRepository);
  if (repo?.path?.trim()) return repo.path.trim();

  return session.repositoryPath.trim();
}
