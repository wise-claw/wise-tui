import type { ClaudeSession, Repository } from "../types";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";

export const REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY = "wise.repositoryMainSessionBindings.v1";

export function normalizeRepositoryPathKey(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

export function parseRepositoryMainSessionBindings(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        out[normalizeRepositoryPathKey(k)] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 可作为「仓库主会话」绑定目标：
 * - 未配置主 Owner 智能体：路径一致且无 `员工:` 子会话展示名；
 * - 已配置：路径一致且 `员工:` 后姓名与配置一致。
 */
export function isRepositoryMainSessionTab(
  session: ClaudeSession,
  repositoryPathKey: string,
  mainOwnerAgentName?: string | null,
): boolean {
  if (normalizeRepositoryPathKey(session.repositoryPath) !== repositoryPathKey) return false;
  const configured = mainOwnerAgentName?.trim();
  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (configured) {
    return employeeName === configured;
  }
  return !employeeName;
}

export function resolveMainOwnerAgentNameForRepositoryPath(
  repositories: Repository[],
  repositoryPath: string,
): string | null {
  const key = normalizeRepositoryPathKey(repositoryPath);
  const hit = repositories.find((r) => normalizeRepositoryPathKey(r.path) === key);
  const v = hit?.mainOwnerAgentName?.trim();
  return v && v.length > 0 ? v : null;
}

export function resolveBoundMainSessionId(
  repositoryPath: string,
  bindings: Record<string, string>,
  sessions: ClaudeSession[],
  mainOwnerAgentName?: string | null,
): string | null {
  const key = normalizeRepositoryPathKey(repositoryPath);
  const bound = bindings[key]?.trim();
  if (!bound) return null;
  const s = sessions.find((x) => x.id === bound);
  if (!s || !isRepositoryMainSessionTab(s, key, mainOwnerAgentName)) return null;
  return bound;
}
