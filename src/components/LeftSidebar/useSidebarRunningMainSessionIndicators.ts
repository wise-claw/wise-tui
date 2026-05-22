import { useMemo } from "react";
import type { ClaudeHostProcess, ClaudeSession, Repository } from "../../types";
import { buildSidebarRunningMainSessionMaps } from "../../utils/sidebarRunningMainSessionIndicators";

interface UseSidebarRunningMainSessionIndicatorsInput {
  projects: ReadonlyArray<{ id: string }>;
  repositories: Repository[];
  sessions: ClaudeSession[];
  repositoryMainSessionBindings: Record<string, string>;
  claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
}

export function useSidebarRunningMainSessionIndicators({
  projects,
  repositories,
  sessions,
  repositoryMainSessionBindings,
  claudeProcesses,
}: UseSidebarRunningMainSessionIndicatorsInput) {
  return useMemo(
    () =>
      buildSidebarRunningMainSessionMaps({
        projects,
        repositories,
        sessions,
        bindings: repositoryMainSessionBindings,
        claudeProcesses,
      }),
    [projects, repositories, sessions, repositoryMainSessionBindings, claudeProcesses],
  );
}
