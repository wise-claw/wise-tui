import { useMemo, type RefObject } from "react";
import type { ClaudeHostProcess, ClaudeSession, Repository } from "../../types";
import { buildSidebarRunningMainSessionMaps } from "../../utils/sidebarRunningMainSessionIndicators";

interface UseSidebarRunningMainSessionIndicatorsInput {
  projects: ReadonlyArray<{ id: string }>;
  repositories: Repository[];
  sessionsRef: RefObject<readonly ClaudeSession[]>;
  sessionsStructureKey: string;
  repositoryMainSessionBindings: Record<string, string>;
  claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  registryRunningClaudeSessionIds?: ReadonlySet<string>;
}

export function useSidebarRunningMainSessionIndicators({
  projects,
  repositories,
  sessionsRef,
  sessionsStructureKey,
  repositoryMainSessionBindings,
  claudeProcesses,
  registryRunningClaudeSessionIds,
}: UseSidebarRunningMainSessionIndicatorsInput) {
  return useMemo(
    () =>
      buildSidebarRunningMainSessionMaps({
        projects,
        repositories,
        sessions: sessionsRef.current,
        bindings: repositoryMainSessionBindings,
        claudeProcesses,
        registryRunningClaudeSessionIds,
      }),
    [
      projects,
      repositories,
      sessionsRef,
      sessionsStructureKey,
      repositoryMainSessionBindings,
      claudeProcesses,
      registryRunningClaudeSessionIds,
    ],
  );
}
