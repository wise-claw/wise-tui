import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { message, Tooltip } from "antd";
import { memo, useCallback, useMemo } from "react";
import { useWorkspaceQuickActions } from "../hooks/useWorkspaceQuickActions";
import { openExternalUrl } from "../services/openExternal";
import { openInFinder } from "../services/repository";
import {
  filterWorkspaceQuickActionsForTopbar,
  type WorkspaceQuickActionDisplayItem,
} from "../types/workspaceQuickActions";
import "./WorkspaceQuickActionsTopbarStrip.css";

export interface WorkspaceQuickActionsTopbarStripProps {
  projectId: string | null;
  repositoryId: number | null;
}

export const WorkspaceQuickActionsTopbarStrip = memo(function WorkspaceQuickActionsTopbarStrip({
  projectId,
  repositoryId,
}: WorkspaceQuickActionsTopbarStripProps) {
  const { displayItems } = useWorkspaceQuickActions({ projectId, repositoryId });
  const pinnedItems = useMemo(
    () => filterWorkspaceQuickActionsForTopbar(displayItems),
    [displayItems],
  );

  const openItem = useCallback((item: WorkspaceQuickActionDisplayItem) => {
    if (item.kind === "link") {
      void openExternalUrl(item.target);
      return;
    }
    void openInFinder(item.target).catch((err: unknown) => {
      console.error(err);
      message.error("无法在 Finder 中打开目录");
    });
  }, []);

  if (pinnedItems.length === 0) {
    return null;
  }

  return (
    <span className="app-topbar-workspace-quick-actions" role="toolbar" aria-label="顶栏快捷操作">
      {pinnedItems.map((item) => (
        <Tooltip
          key={`${item.scope}:${item.id}`}
          title={item.target}
          mouseEnterDelay={0.35}
        >
          <button
            type="button"
            className="app-topbar-workspace-quick-action-chip"
            onClick={() => openItem(item)}
          >
            <span className="app-topbar-workspace-quick-action-chip__icon" aria-hidden>
              {item.kind === "link" ? <LinkOutlined /> : <FolderOpenOutlined />}
            </span>
            <span className="app-topbar-workspace-quick-action-chip__label">{item.label}</span>
          </button>
        </Tooltip>
      ))}
    </span>
  );
});
