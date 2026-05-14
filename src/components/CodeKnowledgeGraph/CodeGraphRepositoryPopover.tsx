import {
  BulbOutlined,
  CaretDownOutlined,
  DeleteOutlined,
  FolderOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Modal, Popover, Tooltip } from "antd";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

export interface CodeGraphRepositoryMenuItem {
  id: number;
  name: string;
  path: string;
  repositoryType?: "frontend" | "backend" | "document";
}

interface Props {
  repositories: CodeGraphRepositoryMenuItem[];
  activeRepositoryId: number | null;
  /** 当前选中仓库是否已建立图谱索引（仅影响触发器上的状态点） */
  activeRepositoryIndexed?: boolean;
  onSelectRepository?: (repoId: number) => void;
  /** 为指定仓库提交图谱重建（可与当前选中仓库不同） */
  onReindexRepository?: (repoId: number) => void | Promise<void>;
  /** 从 Wise 全局移除仓库 */
  onRemoveRepository?: (repoId: number) => void | Promise<void>;
  /** 与侧栏「添加游离仓库」一致：选目录并注册 */
  onOpenAddRepository?: () => void | Promise<void>;
  disabled?: boolean;
}

export function CodeGraphRepositoryPopover({
  repositories,
  activeRepositoryId,
  activeRepositoryIndexed = false,
  onSelectRepository,
  onReindexRepository,
  onRemoveRepository,
  onOpenAddRepository,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeRepo = useMemo(
    () => repositories.find((r) => r.id === activeRepositoryId) ?? null,
    [repositories, activeRepositoryId],
  );

  const triggerLabel = activeRepo?.name ?? "选择仓库";

  const close = useCallback(() => setOpen(false), []);

  const handlePick = useCallback(
    (id: number) => {
      onSelectRepository?.(id);
      close();
    },
    [onSelectRepository, close],
  );

  const handleReindex = useCallback(
    (e: MouseEvent, id: number) => {
      e.preventDefault();
      e.stopPropagation();
      void onReindexRepository?.(id);
    },
    [onReindexRepository],
  );

  const handleRemove = useCallback(
    (e: MouseEvent, repo: CodeGraphRepositoryMenuItem) => {
      e.preventDefault();
      e.stopPropagation();
      if (!onRemoveRepository) return;
      Modal.confirm({
        title: "从 Wise 移除仓库？",
        content: `将移除「${repo.name}」并解除与所有项目的关联，此操作不可恢复。`,
        okText: "移除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => onRemoveRepository(repo.id),
      });
    },
    [onRemoveRepository],
  );

  const handleAdd = useCallback(() => {
    close();
    void onOpenAddRepository?.();
  }, [onOpenAddRepository, close]);

  const dropdown: ReactNode = (
    <div className="app-code-graph-repo-dropdown" role="menu" onClick={(ev) => ev.stopPropagation()}>
      <div className="app-code-graph-repo-dropdown-header">REPOSITORIES</div>
      <ul className="app-code-graph-repo-dropdown-list">
        {repositories.map((repo) => {
          const isActive = repo.id === activeRepositoryId;
          return (
            <li key={repo.id} className="app-code-graph-repo-dropdown-li">
              <button
                type="button"
                className={`app-code-graph-repo-dropdown-row${isActive ? " app-code-graph-repo-dropdown-row--active" : ""}`}
                onClick={() => handlePick(repo.id)}
              >
                <span className="app-code-graph-repo-dropdown-row-main">
                  <FolderOutlined className="app-code-graph-repo-icon" aria-hidden />
                  <span className="app-code-graph-repo-dropdown-name">{repo.name}</span>
                </span>
                <span className="app-code-graph-repo-dropdown-row-actions">
                  {isActive ? (
                    <span className="app-code-graph-repo-dropdown-active-pill">active</span>
                  ) : null}
                  {onReindexRepository ? (
                    <Tooltip title="重建图谱索引">
                      <span
                        role="button"
                        tabIndex={0}
                        className="app-code-graph-repo-dropdown-icon-btn"
                        onClick={(e) => handleReindex(e, repo.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            handleReindex(e as unknown as MouseEvent, repo.id);
                          }
                        }}
                      >
                        <ReloadOutlined />
                      </span>
                    </Tooltip>
                  ) : null}
                  {onRemoveRepository ? (
                    <Tooltip title="从 Wise 移除">
                      <span
                        role="button"
                        tabIndex={0}
                        className="app-code-graph-repo-dropdown-icon-btn app-code-graph-repo-dropdown-icon-btn--danger"
                        onClick={(e) => handleRemove(e, repo)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            handleRemove(e as unknown as MouseEvent, repo);
                          }
                        }}
                      >
                        <DeleteOutlined />
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {onOpenAddRepository ? (
        <button type="button" className="app-code-graph-repo-dropdown-footer" onClick={handleAdd}>
          <BulbOutlined className="app-code-graph-repo-dropdown-footer-icon" aria-hidden />
          <span>分析新仓库…</span>
        </button>
      ) : null}
    </div>
  );

  const canInteract = Boolean(onSelectRepository) && repositories.length > 0 && !disabled;

  return (
    <Popover
      open={open && canInteract}
      onOpenChange={(next) => {
        if (!canInteract) return;
        setOpen(next);
      }}
      trigger="click"
      placement="bottomLeft"
      content={dropdown}
      rootClassName="app-code-graph-repo-popover-root"
      getPopupContainer={(trigger) => trigger.closest(".app-code-graph-panel") ?? document.body}
    >
      <button
        type="button"
        className={`app-code-graph-repo-trigger${open ? " app-code-graph-repo-trigger--open" : ""}`}
        disabled={!canInteract}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="选择仓库"
      >
        <span
          className={`app-code-graph-repo-trigger-dot${activeRepositoryIndexed ? " app-code-graph-repo-trigger-dot--ok" : ""}`}
          aria-hidden
        />
        <span className="app-code-graph-repo-trigger-label">{triggerLabel}</span>
        <CaretDownOutlined className="app-code-graph-repo-trigger-caret" />
      </button>
    </Popover>
  );
}
