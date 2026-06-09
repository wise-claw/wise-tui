import { useEffect, useMemo } from "react";
import type { ProjectItem, Repository } from "../types";
import {
  buildWorkspaceTodoCountsScopeKey,
  syncWorkspaceTodoCountsScope,
} from "../stores/workspaceTodoCountsStore";

/** 初始化待办角标 store；不向 LeftSidebar 注入会随角标变化的 state。 */
export function useWorkspaceTodoCountsBootstrap(
  projects: ProjectItem[],
  floatingRepositories: Repository[],
  enabled = true,
): void {
  const scopeKey = useMemo(
    () => buildWorkspaceTodoCountsScopeKey(projects, floatingRepositories),
    [projects, floatingRepositories],
  );

  useEffect(() => {
    return syncWorkspaceTodoCountsScope(projects, floatingRepositories, enabled);
  }, [enabled, scopeKey, projects, floatingRepositories]);
}
