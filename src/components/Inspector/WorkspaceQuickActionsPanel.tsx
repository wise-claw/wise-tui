import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Spin, Tag, Tooltip, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import { openExternalUrl } from "../../services/openExternal";
import { openInFinder } from "../../services/repository";
import { useWorkspaceQuickActions } from "../../hooks/useWorkspaceQuickActions";
import {
  createWorkspaceQuickActionId,
  type WorkspaceQuickActionDisplayItem,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionScope,
} from "../../types/workspaceQuickActions";
import { WorkspaceQuickActionsEditModal } from "./WorkspaceQuickActionsEditModal";
import "./WorkspaceQuickActionsPanel.css";

export interface WorkspaceQuickActionsPanelProps {
  projectId: string | null;
  projectName?: string | null;
  repositoryId: number | null;
  repositoryName?: string | null;
}

type EditState =
  | { mode: "create" }
  | { mode: "edit"; item: WorkspaceQuickActionItem; scope: WorkspaceQuickActionScope };

export function WorkspaceQuickActionsPanel({
  projectId,
  projectName,
  repositoryId,
  repositoryName,
}: WorkspaceQuickActionsPanelProps) {
  const { message, modal } = App.useApp();
  const quickActions = useWorkspaceQuickActions({ projectId, repositoryId });
  const [editState, setEditState] = useState<EditState | null>(null);

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultScope: WorkspaceQuickActionScope = allowRepositoryScope ? "repository" : "project";

  const scopeHint = useMemo(() => {
    const parts: string[] = [];
    if (allowProjectScope && projectName?.trim()) {
      parts.push(`工作区「${projectName.trim()}」`);
    }
    if (allowRepositoryScope && repositoryName?.trim()) {
      parts.push(`仓库「${repositoryName.trim()}」`);
    }
    return parts.length > 0 ? parts.join(" · ") : "未选择工作区或仓库";
  }, [allowProjectScope, allowRepositoryScope, projectName, repositoryName]);

  const upsertItem = useCallback(
    async (
      scope: WorkspaceQuickActionScope,
      input: { kind: WorkspaceQuickActionItem["kind"]; label: string; target: string },
      existingId?: string,
    ) => {
      const now = Date.now();
      const source =
        scope === "project" ? quickActions.projectItemsRef.current : quickActions.repositoryItemsRef.current;
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
      quickActions.setItemsForScope(scope, next);
      await quickActions.flushPersist(scope, next);
      message.success(index >= 0 ? "已更新快捷操作" : "已添加快捷操作");
    },
    [message, quickActions],
  );

  const removeItem = useCallback(
    (item: WorkspaceQuickActionDisplayItem) => {
      modal.confirm({
        title: "删除该快捷操作？",
        content: `「${item.label}」将从${item.scope === "project" ? "工作区" : "仓库"}配置中移除。`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          const source =
            item.scope === "project"
              ? quickActions.projectItemsRef.current
              : quickActions.repositoryItemsRef.current;
          const next = source.filter((row) => row.id !== item.id);
          quickActions.setItemsForScope(item.scope, next);
          await quickActions.flushPersist(item.scope, next);
          message.success("已删除");
        },
      });
    },
    [message, modal, quickActions],
  );

  const openItem = useCallback(
    (item: WorkspaceQuickActionDisplayItem) => {
      if (item.kind === "link") {
        void openExternalUrl(item.target);
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
    <section className="app-workspace-quick-actions-panel" aria-label="快捷操作">
      <header className="app-workspace-quick-actions-panel__head">
        <div className="app-workspace-quick-actions-panel__head-main">
          <Typography.Text strong className="app-workspace-quick-actions-panel__title">
            快捷操作
          </Typography.Text>
          <Typography.Text type="secondary" className="app-workspace-quick-actions-panel__hint">
            {scopeHint}
          </Typography.Text>
        </div>
        <Tooltip title="添加链接或本地目录" mouseEnterDelay={0.35}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="添加快捷操作"
            disabled={!quickActions.hasScope}
            onClick={() => setEditState({ mode: "create" })}
          />
        </Tooltip>
      </header>

      <div className="app-workspace-quick-actions-panel__body">
        {quickActions.loading ? (
          <div className="app-workspace-quick-actions-panel__loading">
            <Spin size="small" />
          </div>
        ) : !quickActions.hasScope ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请先在左侧选择工作区或仓库"
          />
        ) : quickActions.displayItems.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无快捷操作，点击 + 添加">
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setEditState({ mode: "create" })}
            >
              添加
            </Button>
          </Empty>
        ) : (
          <ul className="app-workspace-quick-actions-panel__list">
            {quickActions.displayItems.map((item) => (
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
                  <Tooltip title="编辑" mouseEnterDelay={0.35}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      aria-label="编辑"
                      onClick={() =>
                        setEditState({ mode: "edit", item, scope: item.scope })
                      }
                    />
                  </Tooltip>
                  <Tooltip title="删除" mouseEnterDelay={0.35}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="删除"
                      onClick={() => removeItem(item)}
                    />
                  </Tooltip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WorkspaceQuickActionsEditModal
        open={editState != null}
        mode={editState?.mode === "edit" ? "edit" : "create"}
        initialItem={editState?.mode === "edit" ? editState.item : null}
        initialScope={editState?.mode === "edit" ? editState.scope : undefined}
        defaultScope={defaultScope}
        allowProjectScope={allowProjectScope}
        allowRepositoryScope={allowRepositoryScope}
        onClose={() => setEditState(null)}
        onSubmit={async (input) => {
          if (editState?.mode === "edit" && editState.scope !== input.scope) {
            const oldSource =
              editState.scope === "project"
                ? quickActions.projectItemsRef.current
                : quickActions.repositoryItemsRef.current;
            const without = oldSource.filter((row) => row.id !== editState.item.id);
            quickActions.setItemsForScope(editState.scope, without);
            await quickActions.flushPersist(editState.scope, without);
          }
          const existingId = editState?.mode === "edit" ? editState.item.id : undefined;
          await upsertItem(input.scope, input, existingId);
        }}
      />
    </section>
  );
}
