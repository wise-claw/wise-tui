import { Checkbox, Popover } from "antd";
import { useMemo } from "react";
import type { Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { VisibilityConfigIcon } from "./SidebarIcons";
import "./WorkspaceRepositoryVisibilityPopover.css";

export interface WorkspaceRepositoryVisibilityPopoverProps {
  repositories: readonly Repository[];
  hiddenIds: readonly number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetHidden: (repositoryId: number, hidden: boolean) => void;
  onShowAll?: () => void;
}

export function WorkspaceRepositoryVisibilityPopover({
  repositories,
  hiddenIds,
  open,
  onOpenChange,
  onSetHidden,
  onShowAll,
}: WorkspaceRepositoryVisibilityPopoverProps) {
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const hiddenCount = repositories.reduce(
    (count, repo) => count + (hiddenSet.has(repo.id) ? 1 : 0),
    0,
  );
  const tooltip =
    hiddenCount > 0 ? `配置仓库显示（已隐藏 ${hiddenCount} 个）` : "配置仓库显示";

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="app-workspace-repo-visibility-popover"
      destroyOnHidden={false}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={
        <div className="app-workspace-repo-visibility-popover__body">
          <div className="app-workspace-repo-visibility-popover__title">显示仓库</div>
          {repositories.length === 0 ? (
            <div className="app-workspace-repo-visibility-popover__empty">暂无仓库</div>
          ) : (
            <div className="app-workspace-repo-visibility-popover__list">
              {repositories.map((repository) => {
                const visible = !hiddenSet.has(repository.id);
                const name = repositoryFolderBasename(repository);
                return (
                  <div
                    key={repository.id}
                    className="app-workspace-repo-visibility-popover__row"
                  >
                    <Checkbox
                      checked={visible}
                      onChange={(event) => {
                        onSetHidden(repository.id, !event.target.checked);
                      }}
                    >
                      <span className="app-workspace-repo-visibility-popover__name" title={name}>
                        {name}
                      </span>
                    </Checkbox>
                  </div>
                );
              })}
            </div>
          )}
          {hiddenCount > 0 && onShowAll ? (
            <div className="app-workspace-repo-visibility-popover__footer">
              <button
                type="button"
                className="app-workspace-repo-visibility-popover__footer-btn"
                onClick={onShowAll}
              >
                全部显示
              </button>
            </div>
          ) : null}
        </div>
      }
    >
      <DeferredHoverTooltip title={tooltip} open={open ? false : undefined}>
        <button
          type="button"
          className={`app-repository-header-btn${open ? " app-repository-header-btn--active" : ""}`}
          aria-label={tooltip}
          aria-expanded={open}
          aria-pressed={open}
        >
          <VisibilityConfigIcon />
        </button>
      </DeferredHoverTooltip>
    </Popover>
  );
}
