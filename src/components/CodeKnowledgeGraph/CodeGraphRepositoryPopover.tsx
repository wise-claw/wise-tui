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
import { CodeGraphAssociationIcon } from "./CodeGraphAssociationIcon";

export interface CodeGraphRepositoryMenuItem {
  id: number;
  name: string;
  path: string;
  repositoryType?: "frontend" | "backend" | "document";
}

/** 仓库下拉内：最近选中的是「某一仓库」还是「关联合并项」 */
export type CodeGraphRepoDropdownSelection = "repository" | "association";

interface Props {
  repositories: CodeGraphRepositoryMenuItem[];
  activeRepositoryId: number | null;
  /** 当前选中仓库是否已建立图谱索引（仅影响触发器上的状态点） */
  activeRepositoryIndexed?: boolean;
  /**
   * 选中「关联合并」时用于触发器主文案（如 `(a + b)`）；选中单仓时应为 null，触发器显示当前仓名。
   */
  graphScopeTriggerLabel?: string | null;
  /** 与 `active` 标签一致：选中仓库行 vs 选中底部关联合并行 */
  menuSelection?: CodeGraphRepoDropdownSelection;
  onSelectRepository?: (repoId: number) => void;
  /** 为指定仓库提交图谱重建（可与当前选中仓库不同） */
  onReindexRepository?: (repoId: number) => void | Promise<void>;
  /** 从 Wise 全局移除仓库 */
  onRemoveRepository?: (repoId: number) => void | Promise<void>;
  /** 与侧栏「添加游离仓库」一致：选目录并注册 */
  onOpenAddRepository?: () => void | Promise<void>;
  /** 当前多仓合并范围展示，如 (vocs-web + crewAI)；为 null 时不显示 */
  associationScopeDisplay?: string | null;
  /** 点击后关闭菜单并刷新主区，查看该范围内的多仓合并图谱 */
  onViewMergedGraph?: () => void;
  /** 当前合并范围对应的仓库 id（长度 ≥2 时与 `associationScopeDisplay` 一致） */
  associationScopeRepositoryIds?: number[];
  /** 对当前合并范围触发「同步仓库组」（与侧栏关联检索一致） */
  onReindexAssociationScope?: (repositoryIds: number[]) => void | Promise<void>;
  /** 退出多仓合并视图，将关联范围重置为仅当前仓库（不移除 Wise 中的仓库） */
  onDismissAssociationScope?: () => void | Promise<void>;
  /** 未就绪时禁用（如当前仓未索引） */
  associationScopeDisabled?: boolean;
  /** 为 true 时不列出各仓库行，仅展示底部多仓关联项（如从多仓项目进入图谱） */
  hideRepositoryList?: boolean;
  disabled?: boolean;
}

export function CodeGraphRepositoryPopover({
  repositories,
  activeRepositoryId,
  activeRepositoryIndexed = false,
  graphScopeTriggerLabel = null,
  menuSelection = "repository",
  onSelectRepository,
  onReindexRepository,
  onRemoveRepository,
  onOpenAddRepository,
  associationScopeDisplay = null,
  onViewMergedGraph,
  associationScopeRepositoryIds,
  onReindexAssociationScope,
  onDismissAssociationScope,
  associationScopeDisabled = false,
  hideRepositoryList = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeRepo = useMemo(
    () => repositories.find((r) => r.id === activeRepositoryId) ?? null,
    [repositories, activeRepositoryId],
  );

  const triggerLabel =
    graphScopeTriggerLabel?.trim() || activeRepo?.name || "选择仓库";

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

  const associationIds = useMemo(() => {
    const raw = associationScopeRepositoryIds ?? [];
    return [...new Set(raw.filter((id) => typeof id === "number" && Number.isFinite(id)))];
  }, [associationScopeRepositoryIds]);

  const handleReindexAssociation = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (associationIds.length < 2) return;
      void onReindexAssociationScope?.(associationIds);
    },
    [associationIds, onReindexAssociationScope],
  );

  const handleDismissAssociation = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!onDismissAssociationScope) return;
      Modal.confirm({
        title: "退出多仓合并视图？",
        content:
          "将把关联图谱范围重置为仅当前仓库，并切换到单仓视图。不会从 Wise 移除任何仓库。",
        okText: "退出",
        okType: "danger",
        cancelText: "取消",
        onOk: () => {
          void onDismissAssociationScope?.();
          close();
        },
      });
    },
    [onDismissAssociationScope, close],
  );

  const dropdown: ReactNode = (
    <div className="app-code-graph-repo-dropdown" role="menu" onClick={(ev) => ev.stopPropagation()}>
      <div className="app-code-graph-repo-dropdown-header">
        {hideRepositoryList ? "关联范围" : "REPOSITORIES"}
      </div>
      {!hideRepositoryList ? (
        <ul className="app-code-graph-repo-dropdown-list">
          {repositories.map((repo) => {
            const isActive = menuSelection === "repository" && repo.id === activeRepositoryId;
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
                      <Tooltip title="重新检索代码图谱">
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
      ) : null}
      {associationScopeDisplay && onViewMergedGraph ? (
        <div
          className={`app-code-graph-repo-dropdown-assoc-wrap${associationScopeDisabled ? " app-code-graph-repo-dropdown-assoc-wrap--disabled" : ""}${menuSelection === "association" && !associationScopeDisabled ? " app-code-graph-repo-dropdown-assoc-wrap--active" : ""}`}
        >
          <button
            type="button"
            className="app-code-graph-repo-dropdown-assoc-row"
            disabled={associationScopeDisabled}
            title={
              associationScopeDisabled
                ? "请先完成当前仓库图谱索引"
                : "查看多仓库合并图谱（按当前关联范围刷新画布）"
            }
            aria-label={`查看多仓合并图谱 ${associationScopeDisplay}`}
            aria-current={menuSelection === "association" && !associationScopeDisabled ? "true" : undefined}
            onMouseDown={(e) => {
              // 避免 Popover 在 mousedown 阶段抢焦点导致 click 未触发（Ant Design 下拉内按钮常见坑）
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (associationScopeDisabled) return;
              onViewMergedGraph();
              close();
            }}
          >
            <span className="app-code-graph-repo-dropdown-assoc-row-main">
              <CodeGraphAssociationIcon className="app-code-graph-repo-dropdown-assoc-icon" aria-hidden />
              <span className="app-code-graph-repo-dropdown-assoc-label">{associationScopeDisplay}</span>
            </span>
          </button>
          <span
            className="app-code-graph-repo-dropdown-row-actions app-code-graph-repo-dropdown-assoc-row-actions"
            role="presentation"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuSelection === "association" && !associationScopeDisabled ? (
              <span className="app-code-graph-repo-dropdown-active-pill">active</span>
            ) : null}
            {onReindexAssociationScope && associationIds.length >= 2 ? (
              <Tooltip title="同步 GitNexus 仓库组">
                <span
                  role="button"
                  tabIndex={0}
                  className={`app-code-graph-repo-dropdown-icon-btn${associationScopeDisabled ? " app-code-graph-repo-dropdown-icon-btn--disabled" : ""}`}
                  aria-disabled={associationScopeDisabled}
                  onClick={(e) => {
                    if (associationScopeDisabled) return;
                    handleReindexAssociation(e);
                  }}
                  onKeyDown={(e) => {
                    if (associationScopeDisabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                      handleReindexAssociation(e as unknown as MouseEvent);
                    }
                  }}
                >
                  <ReloadOutlined />
                </span>
              </Tooltip>
            ) : null}
            {onDismissAssociationScope ? (
              <Tooltip title="删除关联范围">
                <span
                  role="button"
                  tabIndex={0}
                  className={`app-code-graph-repo-dropdown-icon-btn app-code-graph-repo-dropdown-icon-btn--danger${associationScopeDisabled ? " app-code-graph-repo-dropdown-icon-btn--disabled" : ""}`}
                  aria-disabled={associationScopeDisabled}
                  onClick={(e) => {
                    if (associationScopeDisabled) return;
                    handleDismissAssociation(e);
                  }}
                  onKeyDown={(e) => {
                    if (associationScopeDisabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                      handleDismissAssociation(e as unknown as MouseEvent);
                    }
                  }}
                >
                  <DeleteOutlined />
                </span>
              </Tooltip>
            ) : null}
          </span>
        </div>
      ) : null}
      {onOpenAddRepository ? (
        <button type="button" className="app-code-graph-repo-dropdown-footer" onClick={handleAdd}>
          <BulbOutlined className="app-code-graph-repo-dropdown-footer-icon" aria-hidden />
          <span>分析新仓库…</span>
        </button>
      ) : null}
    </div>
  );

  const hasAssociationMenu = Boolean(associationScopeDisplay && onViewMergedGraph);
  const canInteract =
    !disabled &&
    repositories.length > 0 &&
    ((!hideRepositoryList && Boolean(onSelectRepository)) ||
      (hideRepositoryList && (hasAssociationMenu || Boolean(onOpenAddRepository))));

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
      /** 勿挂到 `.app-code-graph-panel`：该容器 `overflow:hidden` 会裁掉浮层，表现为点击下拉无反应 */
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className={`app-code-graph-repo-trigger${open ? " app-code-graph-repo-trigger--open" : ""}`}
        disabled={!canInteract}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hideRepositoryList ? "多仓关联范围" : "选择仓库"}
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
