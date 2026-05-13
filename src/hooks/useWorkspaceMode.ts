import { useMemo } from "react";
import type { ProjectItem } from "../types";
import { resolveWorkspaceMode, type WorkspaceMode } from "../utils/workspaceMode";

export interface UseWorkspaceModeInput {
  activeProjectId: string | null;
  projects: ReadonlyArray<ProjectItem>;
}

/**
 * 暴露 workspace 派生形态供 UI / Trellis bridge / startup effect 统一消费。
 *
 * 纯派生 hook，不发起 Tauri / 副作用调用；仅记忆化 `resolveWorkspaceMode` 结果。
 */
export function useWorkspaceMode(input: UseWorkspaceModeInput): WorkspaceMode {
  const { activeProjectId, projects } = input;
  return useMemo(
    () => resolveWorkspaceMode({ activeProjectId, projects }),
    [activeProjectId, projects],
  );
}
