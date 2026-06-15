import {
  normalizeSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import type { EmployeeItem, Repository } from "../types";
import { normalizeEmployeeBindingName } from "./employeeBindingName";
import { parseExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import { isProjectRootSessionDisplayName, normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";

function findEnabledEmployeeByBindingName(
  employees: readonly EmployeeItem[],
  bindingName: string,
): EmployeeItem | undefined {
  const target = normalizeEmployeeBindingName(bindingName);
  if (!target) return undefined;
  return employees.find(
    (employee) =>
      employee.enabled && normalizeEmployeeBindingName(employee.name) === target,
  );
}

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
    if (findEnabledEmployeeByBindingName(employees, employeeName)) return null;
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
  const execWorker = parseExecutionEnvironmentWorkerRepositoryName(session.repositoryName ?? "");
  if (execWorker) {
    return normalizeSessionExecutionEngine(execWorker.engine);
  }

  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (employeeName) {
    const match = findEnabledEmployeeByBindingName(employees, employeeName);
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

/** Cursor / Codex 以 Wise 标签 id 作为磁盘 transcript 与 cancel 的 session key。 */
export function usesWiseTabIdForDiskTranscript(engine: SessionExecutionEngine): boolean {
  return engine === "cursor" || engine === "codex";
}

export function resolveDiskTranscriptSessionKey(
  session: { id: string; claudeSessionId?: string | null },
  engine: SessionExecutionEngine,
): string {
  if (usesWiseTabIdForDiskTranscript(engine)) {
    return session.id.trim();
  }
  return session.claudeSessionId?.trim() ?? "";
}

export function sessionHasDiskTranscript(
  session: { id: string; claudeSessionId?: string | null },
  engine: SessionExecutionEngine,
): boolean {
  return Boolean(resolveDiskTranscriptSessionKey(session, engine));
}

/** 主会话消息区空状态：与 Composer 执行引擎选择一致。 */
export function buildSessionEmptyChatPrompt(engine: SessionExecutionEngine): string {
  return `发送消息开始与 ${SESSION_EXECUTION_ENGINE_LABELS[engine].title} 对话`;
}
