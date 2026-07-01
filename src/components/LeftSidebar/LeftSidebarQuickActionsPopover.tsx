import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@ant-design/icons";
import { App, Button, Popover, Spin, Tag, Typography } from "antd";
import { useCallback, useState, type MouseEvent } from "react";
import { openExternalUrl } from "../../services/openExternal";
import { openInFinder } from "../../services/repository";
import { useWorkspaceQuickActions } from "../../hooks/useWorkspaceQuickActions";
import {
  createWorkspaceQuickActionId,
  resolveWorkspaceQuickActionPinnedToTopbar,
  type WorkspaceQuickActionDisplayItem,
  type WorkspaceQuickActionItem,
} from "../../types/workspaceQuickActions";
import type { Repository, Workspace } from "../../types";
import { flushWorkspaceQuickActionsPersist } from "../../stores/workspaceQuickActionsRuntimeStore";
import { WorkspaceQuickActionsEditModal } from "../Inspector/WorkspaceQuickActionsEditModal";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { QuickActionsIcon } from "./SidebarIcons";
import "./LeftSidebarQuickActionsPopover.css";

export interface LeftSidebarQuickActionsPopoverProps {
  projectId: string | null;
  repositoryId: number | null;
  workspaces: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: Repository[];
}

type EditState =
  | { mode: "create" }
  | { mode: "edit"; item: WorkspaceQuickActionItem; scope: WorkspaceQuickActionScope; scopeId: string };

type WorkspaceQuickActionScope = "project" | "repository";

export function LeftSidebarQuickActionsPopover({
  projectId,
  repositoryId,
  workspaces,
  repositoriesById,
  floatingRepositories,
}: LeftSidebarQuickActionsPopoverProps) {
  const { message, modal } = App.useApp();
  const quickActions = useWorkspaceQuickActions({ projectId, repositoryId });
  const [open, setOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);

  const allowProjectScope = Boolean(projectId?.trim()) || workspaces.length > 0;
  const allowRepositoryScope = repositoryId != null || repositoriesById.size > 0;
  const defaultScope: WorkspaceQuickActionScope = allowRepositoryScope && repositoryId != null
    ? "repository"
    : "project";

  const stopRowActionEvent = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const resolveScopeId = useCallback(
    (scope: WorkspaceQuickActionScope): string | null => {
      if (scope === "project") {
        return projectId?.trim() || null;
      }
      if (repositoryId != null && Number.isFinite(repositoryId) && repositoryId > 0) {
        return String(repositoryId);
      }
      return null;
    },
    [projectId, repositoryId],
  );

  const upsertItem = useCallback(
    async (
      scope: WorkspaceQuickActionScope,
      scopeId: string,
      input: { kind: WorkspaceQuickActionItem["kind"]; label: string; target: string },
      existingId?: string,
    ) => {
      const now = Date.now();
      let source = quickActions.readScopeItems(scope, scopeId);
      if (existingId && !source.some((row) => row.id === existingId)) {
        // 兜底：旧实现下跨 scope 编辑，先用 displayItems 拿到同 scope 的其它条目
        source = quickActions.displayItems
          .filter((row) => row.scope === scope)
          .map(({ scope: _scope, ...row }) => row);
      }
      const next = [...source];
      const index = existingId ? next.findIndex((row) => row.id === existingId) : -1;
      if (index >= 0) {
        next[index] = {
          ...next[index],
          kind: input.kind,
          label: input.label,
          target: input.target,
          updatedAt: now,
        };
      } else {
        next.unshift({
          id: createWorkspaceQuickActionId(),
          kind: input.kind,
          label: input.label,
          target: input.target,
          createdAt: now,
          updatedAt: now,
        });
      }
      const ok = await flushWorkspaceQuickActionsPersist(scope, scopeId, next);
      if (!ok) {
        message.error("快捷操作保存失败");
        throw new Error("快捷操作保存失败");
      }
    },
    [message, quickActions],
  );

  const removeItem = useCallback(
    (item: WorkspaceQuickActionDisplayItem, scopeId: string) => {
      modal.confirm({
        title: "删除该快捷操作？",
        content: `「${item.label}」将从${item.scope === "project" ? "工作区" : "仓库"}配置中移除。`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          const source = quickActions.readScopeItems(item.scope, scopeId);
          let next = source.filter((row) => row.id !== item.id);
          if (next.length === source.length) {
            const fallbackSource = quickActions.displayItems
              .filter((row) => row.scope === item.scope)
              .map(({ scope: _scope, ...row }) => row);
            next = fallbackSource.filter((row) => row.id !== item.id);
            if (next.length === fallbackSource.length) {
              message.error("未找到要删除的快捷操作");
              throw new Error("未找到要删除的快捷操作");
            }
          }
          const ok = await flushWorkspaceQuickActionsPersist(item.scope, scopeId, next);
          if (!ok) {
            message.error("快捷操作删除失败");
            throw new Error("快捷操作删除失败");
          }
        },
      });
    },
    [message, modal, quickActions],
  );

  const openItem = useCallback(
    (item: WorkspaceQuickActionDisplayItem) => {
      if (item.kind === "link") {
        void openExternalUrl(item.target).catch((err: unknown) => {
          console.error(err);
          message.error("无法打开链接");
        });
        return;
      }
      void openInFinder(item.target).catch((err: unknown) => {
        console.error(err);
        message.error("无法在 Finder 中打开目录");
      });
    },
    [message],
  );

  const togglePinToTopbar = useCallback(
    async (item: WorkspaceQuickActionDisplayItem, scopeId: string) => {
      const pinned = resolveWorkspaceQuickActionPinnedToTopbar(item);
      const source = quickActions.readScopeItems(item.scope, scopeId);
      const next = source.map((row) =>
        row.id === item.id
          ? {
              ...row,
              pinnedToTopbar: pinned ? undefined : true,
            }
          : row,
      );
      const ok = await flushWorkspaceQuickActionsPersist(item.scope, scopeId, next);
      if (!ok) {
        message.error("快捷操作保存失败");
        throw new Error("快捷操作保存失败");
      }
    },
    [message, quickActions],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="rightTop"
      destroyOnHidden
      getPopupContainer={() => document.body}
      rootClassName="app-left-sidebar-quick-actions-popover"
      styles={{ root: { zIndex: 1200 } }}
      content={
        <div className="app-left-sidebar-quick-actions-popover">
          <div className="app-left-sidebar-quick-actions-popover__header">
            <span>快捷操作</span>
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined style={{ fontSize: 12 }} />}
              aria-label="添加快捷操作"
              disabled={!quickActions.hasScope && workspaces.length === 0 && repositoriesById.size === 0}
              onClick={() => setEditState({ mode: "create" })}
              style={{ width: 20, height: 20, padding: 0 }}
            />
          </div>
          <div className="app-left-sidebar-quick-actions-popover__body">
            {quickActions.loading ? (
              <div className="app-left-sidebar-quick-actions-popover__loading">
                <Spin size="small" />
              </div>
            ) : !quickActions.hasScope ? (
              <div className="app-left-sidebar-quick-actions-popover__empty">
                <Typography.Text type="secondary">请先在左侧选择工作区或仓库</Typography.Text>
              </div>
            ) : quickActions.displayItems.length === 0 ? (
              <div className="app-left-sidebar-quick-actions-popover__empty">
                <Typography.Text type="secondary">暂无快捷操作</Typography.Text>
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined style={{ fontSize: 11 }} />}
                  onClick={() => setEditState({ mode: "create" })}
                  style={{ height: 18, padding: "0 2px", fontSize: 11 }}
                >
                  添加
                </Button>
              </div>
            ) : (
              <ul className="app-left-sidebar-quick-actions-popover__list">
                {quickActions.displayItems.map((item) => {
                  const itemScopeId =
                    item.scope === "project" ? projectId : repositoryId != null ? String(repositoryId) : null;
                  const pinned = resolveWorkspaceQuickActionPinnedToTopbar(item);
                  return (
                    <li
                      key={`${item.scope}:${item.id}`}
                      className="app-left-sidebar-quick-actions-popover__row"
                    >
                      <button
                        type="button"
                        className="app-left-sidebar-quick-actions-popover__row-main"
                        title={item.target}
                        onClick={() => openItem(item)}
                      >
                        <span className="app-left-sidebar-quick-actions-popover__row-icon" aria-hidden>
                          {item.kind === "link" ? <LinkOutlined /> : <FolderOpenOutlined />}
                        </span>
                        <span className="app-left-sidebar-quick-actions-popover__row-label">{item.label}</span>
                        <span className="app-left-sidebar-quick-actions-popover__row-target">{item.target}</span>
                        <Tag bordered={false} className="app-left-sidebar-quick-actions-popover__scope-tag">
                          {item.scope === "project" ? "工作区" : "仓库"}
                        </Tag>
                      </button>
                      <span className="app-left-sidebar-quick-actions-popover__row-actions">
                        <Button
                          type="text"
                          size="small"
                          icon={pinned ? <PushpinFilled /> : <PushpinOutlined />}
                          aria-label={pinned ? "从顶栏移除" : "固定到顶栏"}
                          className={
                            pinned
                              ? "app-left-sidebar-quick-actions-popover__pin-btn--active"
                              : undefined
                          }
                          onClick={(event) => {
                            stopRowActionEvent(event);
                            if (!itemScopeId) return;
                            void togglePinToTopbar(item, itemScopeId);
                          }}
                        />
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          aria-label="编辑"
                          onClick={(event) => {
                            stopRowActionEvent(event);
                            if (!itemScopeId) return;
                            setEditState({ mode: "edit", item, scope: item.scope, scopeId: itemScopeId });
                          }}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label="删除"
                          onClick={(event) => {
                            stopRowActionEvent(event);
                            if (!itemScopeId) return;
                            removeItem(item, itemScopeId);
                          }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <WorkspaceQuickActionsEditModal
            open={editState != null}
            mode={editState?.mode === "edit" ? "edit" : "create"}
            initialItem={editState?.mode === "edit" ? editState.item : null}
            initialScope={editState?.mode === "edit" ? editState.scope : undefined}
            initialScopeId={editState?.mode === "edit" ? editState.scopeId : null}
            activeProjectId={projectId}
            activeRepositoryId={repositoryId}
            workspaces={workspaces}
            repositoriesById={repositoriesById}
            floatingRepositories={floatingRepositories}
            defaultScope={defaultScope}
            compact
            onClose={() => setEditState(null)}
            onSubmit={async (input) => {
              if (editState?.mode === "edit" && editState.scope !== input.scope) {
                const oldSource = quickActions.readScopeItems(editState.scope, editState.scopeId);
                const without = oldSource.filter((row) => row.id !== editState.item.id);
                const removedOk = await flushWorkspaceQuickActionsPersist(
                  editState.scope,
                  editState.scopeId,
                  without,
                );
                if (!removedOk) throw new Error("快捷操作保存失败");
              }
              const existingId = editState?.mode === "edit" ? editState.item.id : undefined;
              await upsertItem(input.scope, input.scopeId, input, existingId);
            }}
          />
        </div>
      }
    >
      <span
        className="app-repository-action-popover-trigger"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative" }}
      >
        <DeferredHoverTooltip title="快捷操作">
          <button
            type="button"
            className="app-repository-header-btn"
            aria-label="快捷操作"
            disabled={!quickActions.hasScope}
          >
            <span className="app-repository-action-icon-wrap">
              <QuickActionsIcon />
              {quickActions.displayItems.length > 0 ? (
                <span className="app-left-sidebar-quick-actions-popover__badge" />
              ) : null}
            </span>
          </button>
        </DeferredHoverTooltip>
      </span>
    </Popover>
  );
}