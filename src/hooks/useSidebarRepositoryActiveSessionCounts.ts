import { useMemo, type RefObject } from "react";
import type { ClaudeSession, Repository } from "../types";

function buildSidebarRepositoryActiveSessionCounts(
  repositories: readonly Repository[],
  sessions: readonly ClaudeSession[],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const repo of repositories) {
    counts[repo.id] = 0;
  }
  for (const session of sessions) {
    if (session.status !== "running" && session.status !== "connecting") continue;
    const repoPath = session.repositoryPath?.trim();
    if (!repoPath) continue;
    const repo = repositories.find((r) => r.path === repoPath);
    if (repo && counts[repo.id] !== undefined) {
      counts[repo.id]++;
    }
  }
  return counts;
}

interface UseSidebarRepositoryActiveSessionCountsInput {
  repositories: readonly Repository[];
  sessionsRef: RefObject<readonly ClaudeSession[]>;
  sessionsStructureKey: string;
}

export function useSidebarRepositoryActiveSessionCounts({
  repositories,
  sessionsRef,
  sessionsStructureKey,
}: UseSidebarRepositoryActiveSessionCountsInput): Record<number, number> {
  return useMemo(
    () => buildSidebarRepositoryActiveSessionCounts(repositories, sessionsRef.current),
    [repositories, sessionsRef, sessionsStructureKey],
  );
}
