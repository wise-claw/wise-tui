import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { openExternalUrl } from "../../services/openExternal";
import { openInFinder } from "../../services/repository";
import { useWorkspaceQuickActions } from "../../hooks/useWorkspaceQuickActions";
import {
  collectWorkspaceQuickActionCategories,
  createWorkspaceQuickActionId,
  groupWorkspaceQuickActionsByCategory,
  normalizeWorkspaceQuickActionCategory,
  resolveWorkspaceQuickActionPinnedToTopbar,
  type WorkspaceQuickActionDisplayItem,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";
import { flushWorkspaceQuickActionsPersist } from "../../stores/workspaceQuickActionsRuntimeStore";
import {
  closeWorkspaceQuickActionsPanel,
  useWorkspaceQuickActionsPanelContext,
} from "../../stores/workspaceQuickActionsPanelStore";
import { WorkspaceQuickActionsEditModal } from "../Inspector/WorkspaceQuickActionsEditModal";
import "./index.css";

type EditState =
  | { mode: "create" }
  | { mode: "edit"; item: WorkspaceQuickActionItem; scope: WorkspaceQuickActionScope; scopeId: string };

/**
 * 中栏快捷操作：与需求面板同一 slot（`panelBelowMessages` + CenterView「files」）。
 */
export function WorkspaceQuickActionsCenterPanel() {
  const { message, modal } = App.useApp();
  const context = useWorkspaceQuickActionsPanelContext();
  const { projectId, repositoryId, additionalRepositoryIds, canManage } = context;

  const quickActions = useWorkspaceQuickActions({
    projectId,
    repositoryId,
    additionalRepositoryIds,
  });
  const groupedItems = useMemo(
    () => groupWorkspaceQuickActionsByCategory(quickActions.displayItems),
    [quickActions.displayItems],
  );
  const showCategoryHeaders = useMemo(
    () =>
      groupedItems.length > 1 || groupedItems.some((group) => group.category.length > 0),
    [groupedItems],
  );
  const categoryOptions = useMemo(
    () => collectWorkspaceQuickActionCategories(quickActions.displayItems),
    [quickActions.displayItems],
  );
  const [managing, setManaging] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);

  const allowRepositoryScope = repositoryId != null || additionalRepositoryIds.length > 0;
  const defaultScope: WorkspaceQuickActionScope =
    allowRepositoryScope && repositoryId != null ? "repository" : "project";

  const stopRowActionEvent = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleClose = useCallback(() => {
    closeWorkspaceQuickActionsPanel();
  }, []);

  useEffect(() => {
    function handleCloseShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") return;
      if (editState != null) return;

      const target = event.target;
      if (target instanceof Element && target.closest(".app-terminal-panel")) return;

      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
    window.addEventListener("keydown", handleCloseShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleCloseShortcut, { capture: true });
  }, [handleClose, editState]);

  const upsertItem = useCallback(
    async (
      scope: WorkspaceQuickActionScope,
      scopeId: string,
      input: {
        kind: WorkspaceQuickActionItem["kind"];
        label: string;
        target: string;
        category: string;
      },
      existingId?: string,
    ) => {
      const now = Date.now();
      const category = normalizeWorkspaceQuickActionCategory(input.category);
      let source = quickActions.readScopeItems(scope, scopeId);
      if (existingId && !source.some((row) => row.id === existingId)) {
        source = quickActions.displayItems
          .filter((row) => row.scope === scope)
          .map(({ scope: _scope, scopeId: _scopeId, ...row }) => row);
      }
      const next = [...source];
      const index = existingId ? next.findIndex((row) => row.id === existingId) : -1;
      if (index >= 0) {
        const current = next[index];
        next[index] = {
          ...current,
          kind: input.kind,
          label: input.label,
          target: input.target,
          updatedAt: now,
          ...(category ? { category } : { category: undefined }),
        };
        if (!category) {
          delete next[index].category;
        }
      } else {
        next.unshift({
          id: createWorkspaceQuickActionId(),
          kind: input.kind,
          label: input.label,
          target: input.target,
          ...(category ? { category } : {}),
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
              .map(({ scope: _scope, scopeId: _scopeId, ...row }) => row);
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

  const closeShortcutLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
      ? "⌘W"
      : "Ctrl+W";

  return (
    <div
      className="app-file-editor-panel app-workspace-quick-actions-center-panel"
      aria-label="快捷操作"
    >
      <div className="app-file-editor-header">
        <div className="app-file-editor-tab-bar">
          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="快捷操作">
            <div
              role="tab"
              aria-selected
              className="app-file-editor-tab app-file-editor-tab--active"
            >
              <span className="app-file-editor-tab-label">快捷操作</span>
            </div>
          </div>
          <div className="app-file-editor-tab-bar-actions">
            <span className="app-workspace-quick-actions-center-panel__status">
              {quickActions.loading
                ? "加载中…"
                : `${quickActions.displayItems.length} 项`}
            </span>
            <Button
              type={managing ? "primary" : "text"}
              size="small"
              icon={<EditOutlined />}
              aria-label={managing ? "完成编辑" : "编辑快捷操作"}
              disabled={quickActions.displayItems.length === 0}
              onClick={() => setManaging((value) => !value)}
            >
              {managing ? "完成" : "编辑"}
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              aria-label="添加快捷操作"
              disabled={!quickActions.hasScope && !canManage}
              onClick={() => setEditState({ mode: "create" })}
            >
              新增
            </Button>
            <Button
              type="text"
              size="small"
              onClick={handleClose}
              title={`关闭（${closeShortcutLabel}）`}
              aria-label={`关闭快捷操作（${closeShortcutLabel}）`}
            >
              关闭
            </Button>
          </div>
        </div>
      </div>

      <div className="app-file-editor-body app-workspace-quick-actions-center-panel__body">
        {quickActions.loading ? (
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        ) : !quickActions.hasScope ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请先在左侧选择工作区或仓库"
          />
        ) : quickActions.displayItems.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无快捷操作，点击「新增」添加链接或目录"
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditState({ mode: "create" })}
            >
              新增快捷操作
            </Button>
          </Empty>
        ) : (
          <div
            className={
              showCategoryHeaders
                ? "app-workspace-quick-actions-center-panel__groups"
                : "app-workspace-quick-actions-center-panel__groups app-workspace-quick-actions-center-panel__groups--flat"
            }
          >
            {groupedItems.map((group) => (
              <section
                key={group.category || "__uncategorized__"}
                className={
                  showCategoryHeaders
                    ? "app-workspace-quick-actions-center-panel__group"
                    : "app-workspace-quick-actions-center-panel__group app-workspace-quick-actions-center-panel__group--flat"
                }
                aria-label={showCategoryHeaders ? `分类 ${group.label}` : "快捷操作列表"}
              >
                {showCategoryHeaders ? (
                  <header
                    className="app-workspace-quick-actions-center-panel__group-header"
                    title={group.label}
                  >
                    <span className="app-workspace-quick-actions-center-panel__group-name">
                      {group.label}
                    </span>
                    <span className="app-workspace-quick-actions-center-panel__group-count">
                      {group.items.length}
                    </span>
                  </header>
                ) : null}
                <ul
                  className={
                    managing
                      ? "app-workspace-quick-actions-center-panel__list app-workspace-quick-actions-center-panel__list--managing"
                      : "app-workspace-quick-actions-center-panel__list"
                  }
                >
                  {group.items.map((item) => {
                    const itemScopeId = item.scopeId;
                    const pinned = resolveWorkspaceQuickActionPinnedToTopbar(item);
                    return (
                      <li
                        key={`${item.scope}:${item.id}`}
                        className="app-workspace-quick-actions-center-panel__card"
                      >
                        <button
                          type="button"
                          className="app-workspace-quick-actions-center-panel__card-main"
                          title={item.target}
                          onClick={() => openItem(item)}
                        >
                          <span
                            className="app-workspace-quick-actions-center-panel__card-icon"
                            aria-hidden
                          >
                            {item.kind === "link" ? <LinkOutlined /> : <FolderOpenOutlined />}
                          </span>
                          <span className="app-workspace-quick-actions-center-panel__card-label">
                            {item.label}
                          </span>
                        </button>
                        <span className="app-workspace-quick-actions-center-panel__card-actions">
                          <Button
                            type="text"
                            size="small"
                            icon={pinned ? <PushpinFilled /> : <PushpinOutlined />}
                            aria-label={pinned ? "从顶栏移除" : "固定到顶栏"}
                            className={
                              pinned
                                ? "app-workspace-quick-actions-center-panel__pin-btn--active"
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
                              setEditState({
                                mode: "edit",
                                item,
                                scope: item.scope,
                                scopeId: itemScopeId,
                              });
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
              </section>
            ))}
          </div>
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
        categoryOptions={categoryOptions}
        defaultScope={defaultScope}
        onClose={() => setEditState(null)}
        onSubmit={async (input) => {
          const existingId = editState?.mode === "edit" ? editState.item.id : undefined;
          await upsertItem(input.scope, input.scopeId, input, existingId);
        }}
      />
    </div>
  );
}

/** 稳定节点：写入 `panelBelowMessages` 时 identity 不随 layout 重渲变化。 */
export const WORKSPACE_QUICK_ACTIONS_PANEL_NODE = <WorkspaceQuickActionsCenterPanel />;
