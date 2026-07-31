import { useEffect, useMemo } from "react";
import type { Repository, Workspace } from "../../types";
import {
  setWorkspaceQuickActionsPanelContext,
  toggleWorkspaceQuickActionsPanel,
  useWorkspaceQuickActionsPanelOpen,
} from "../../stores/workspaceQuickActionsPanelStore";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { QuickActionsIcon } from "./SidebarIcons";

export interface LeftSidebarQuickActionsPopoverProps {
  projectId: string | null;
  repositoryId: number | null;
  workspaces: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: Repository[];
}

/**
 * 侧栏「快捷操作」入口：打开中栏面板（与需求 tab 同一 slot），不再使用 Popover。
 * 组件名保留以兼容既有 import。
 */
export function LeftSidebarQuickActionsPopover({
  projectId,
  repositoryId,
  workspaces,
  repositoriesById,
  floatingRepositories,
}: LeftSidebarQuickActionsPopoverProps) {
  const open = useWorkspaceQuickActionsPanelOpen();

  const additionalRepositoryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of repositoriesById.keys()) {
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    for (const repo of floatingRepositories) {
      if (Number.isFinite(repo.id) && repo.id > 0) ids.add(repo.id);
    }
    return [...ids];
  }, [repositoriesById, floatingRepositories]);

  const canManage =
    Boolean(projectId?.trim()) ||
    repositoryId != null ||
    workspaces.length > 0 ||
    repositoriesById.size > 0 ||
    floatingRepositories.length > 0;

  useEffect(() => {
    setWorkspaceQuickActionsPanelContext({
      projectId,
      repositoryId,
      additionalRepositoryIds,
      canManage,
    });
  }, [projectId, repositoryId, additionalRepositoryIds, canManage]);

  return (
    <DeferredHoverTooltip title="快捷操作">
      <button
        type="button"
        className={`app-repository-header-btn${open ? " app-repository-header-btn--active" : ""}`}
        aria-label="快捷操作"
        aria-pressed={open}
        onClick={() => toggleWorkspaceQuickActionsPanel()}
      >
        <span className="app-repository-action-icon-wrap">
          <QuickActionsIcon />
        </span>
      </button>
    </DeferredHoverTooltip>
  );
}
