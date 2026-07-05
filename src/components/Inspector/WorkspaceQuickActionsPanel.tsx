import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@ant-design/icons";
import { App, Button, Spin, Tag, Typography } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { useCallback, useState, type MouseEvent } from "react";
import { openExternalUrl } from "../../services/openExternal";
import { openInFinder } from "../../services/repository";
import { useWorkspaceQuickActions } from "../../hooks/useWorkspaceQuickActions";
import {
  createWorkspaceQuickActionId,
  resolveWorkspaceQuickActionPinnedToTopbar,
  type WorkspaceQuickActionDisplayItem,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";
import type { Repository, Workspace } from "../../types";
import { WorkspaceQuickActionsEditModal } from "./WorkspaceQuickActionsEditModal";
import { InspectorCollapsibleSection } from "./InspectorCollapsibleSection";
import "./WorkspaceQuickActionsPanel.css";

export interface WorkspaceQuickActionsPanelProps {
  projectId: string | null;
  repositoryId: number | null;
  /** 可选工作区集合；缺省时 Modal 仅允许选当前 scope。 */
  workspaces?: Workspace[];
  /** 工作区内仓库（按 id 索引）。 */
  repositoriesById?: Map<number, Repository>;
  /** 浮动仓库（未绑定工作区的仓库）。 */
  floatingRepositories?: Repository[];
}

type EditState =
  | { mode: "create" }
  | { mode: "edit"; item: WorkspaceQuickActionItem; scope: WorkspaceQuickActionScope; scopeId: string };

export function WorkspaceQuickActionsPanel({
  projectId,
  repositoryId,
  workspaces,
  repositoriesById,
  floatingRepositories,
}: WorkspaceQuickActionsPanelProps) {
  const { message, modal } = App.useApp();
  const quickActions = useWorkspaceQuickActions({ projectId, repositoryId });
  const [editState, setEditState] = useState<EditState | null>(null);

  const allowRepositoryScope = repositoryId != null || (repositoriesById?.size ?? 0) > 0;
  const defaultScope: WorkspaceQuickActionScope =
    allowRepositoryScope && repositoryId != null ? "repository" : "project";

  const stopRowActionEvent = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

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
        source = quickActions.displayItems
          .filter((row) => row.scope === scope)
          .map(({ scope: _scope, scopeId: _scopeId, ...row }) => row);
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
      const ok = await quickActions.flushPersist(scope, next, scopeId);
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
              .map(({ scope: _scope, scopeId: _scopeId, ...row }) => row);
            next = fallbackSource.filter((row) => row.id !== item.id);
            if (next.length === fallbackSource.length) {
              message.error("未找到要删除的快捷操作");
              throw new Error("未找到要删除的快捷操作");
            }
          }
          const ok = await quickActions.flushPersist(item.scope, next, scopeId);
          if (!ok) {
            message.error("快捷操作删除失败");
            throw new Error("快捷操作删除失败");
          }
        },
      });
    },
    [message, modal, quickActions],
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
      const ok = await quickActions.flushPersist(item.scope, next, scopeId);
      if (!ok) {
        message.error("快捷操作保存失败");
        throw new Error("快捷操作保存失败");
      }
    },
    [message, quickActions],
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

  return (
    <InspectorCollapsibleSection
      sectionId="quickActions"
      className="app-workspace-quick-actions-panel"
      ariaLabel="快捷操作"
      title="快捷操作"
      headActions={
        <HoverHint title="添加链接或本地目录">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="添加快捷操作"
            disabled={!quickActions.hasScope}
            onClick={() => setEditState({ mode: "create" })}
          />
        </HoverHint>
      }
      trailing={
        <WorkspaceQuickActionsEditModal
          open={editState != null}
          mode={editState?.mode === "edit" ? "edit" : "create"}
          initialItem={editState?.mode === "edit" ? editState.item : null}
          initialScope={editState?.mode === "edit" ? editState.scope : undefined}
          initialScopeId={editState?.mode === "edit" ? editState.scopeId : null}
          defaultScope={defaultScope}
          activeProjectId={projectId}
          activeRepositoryId={repositoryId}
          workspaces={workspaces}
          repositoriesById={repositoriesById}
          floatingRepositories={floatingRepositories}
          onClose={() => setEditState(null)}
          onSubmit={async (input) => {
            if (editState?.mode === "edit" && editState.scope !== input.scope) {
              const oldSource = quickActions.readScopeItems(editState.scope, editState.scopeId);
              const without = oldSource.filter((row) => row.id !== editState.item.id);
              const removedOk = await quickActions.flushPersist(
                editState.scope,
                without,
                editState.scopeId,
              );
              if (!removedOk) throw new Error("快捷操作保存失败");
            }
            const existingId = editState?.mode === "edit" ? editState.item.id : undefined;
            await upsertItem(input.scope, input.scopeId, input, existingId);
          }}
        />
      }
    >
      <div className="app-workspace-quick-actions-panel__body">
        {quickActions.loading ? (
          <div className="app-workspace-quick-actions-panel__loading">
            <Spin size="small" />
          </div>
        ) : !quickActions.hasScope ? (
          <div className="app-workspace-quick-actions-panel__list-empty">
            <Typography.Text type="secondary">请先在左侧选择工作区或仓库</Typography.Text>
          </div>
        ) : quickActions.displayItems.length === 0 ? (
          <div className="app-workspace-quick-actions-panel__list-empty">
            <Typography.Text type="secondary">暂无快捷操作</Typography.Text>
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setEditState({ mode: "create" })}
            >
              添加
            </Button>
          </div>
        ) : (
          <ul className="app-workspace-quick-actions-panel__list">
            {quickActions.displayItems.map((item) => {
              const itemScopeId = item.scopeId;
              return (
              <li key={`${item.scope}:${item.id}`} className="app-workspace-quick-actions-panel__row">
                <button
                  type="button"
                  className="app-workspace-quick-actions-panel__row-main"
                  title={item.target}
                  onClick={() => openItem(item)}
                >
                  <span className="app-workspace-quick-actions-panel__row-icon" aria-hidden>
                    {item.kind === "link" ? <LinkOutlined /> : <FolderOpenOutlined />}
                  </span>
                  <span className="app-workspace-quick-actions-panel__row-label">{item.label}</span>
                  <span className="app-workspace-quick-actions-panel__row-target">{item.target}</span>
                  <Tag bordered={false} className="app-workspace-quick-actions-panel__scope-tag">
                    {item.scope === "project" ? "工作区" : "仓库"}
                  </Tag>
                </button>
                <span className="app-workspace-quick-actions-panel__row-actions">
                  <HoverHint
                    title={
                      resolveWorkspaceQuickActionPinnedToTopbar(item)
                        ? "从顶栏移除"
                        : "固定到顶栏（远程后面）"
                    }

                  >
                    <Button
                      type="text"
                      size="small"
                      icon={
                        resolveWorkspaceQuickActionPinnedToTopbar(item) ? (
                          <PushpinFilled />
                        ) : (
                          <PushpinOutlined />
                        )
                      }
                      aria-label={
                        resolveWorkspaceQuickActionPinnedToTopbar(item)
                          ? "从顶栏移除"
                          : "固定到顶栏"
                      }
                      className={
                        resolveWorkspaceQuickActionPinnedToTopbar(item)
                          ? "app-workspace-quick-actions-panel__pin-btn--active"
                          : undefined
                      }
                      onClick={(event) => {
                        stopRowActionEvent(event);
                        if (itemScopeId) void togglePinToTopbar(item, itemScopeId);
                      }}
                    />
                  </HoverHint>
                  <HoverHint title="编辑">
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
                  </HoverHint>
                  <HoverHint title="删除">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="删除"
                      onClick={(event) => {
                        stopRowActionEvent(event);
                        if (itemScopeId) removeItem(item, itemScopeId);
                      }}
                    />
                  </HoverHint>
                </span>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </InspectorCollapsibleSection>
  );
}
