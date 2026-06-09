import { FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { Button, Empty, Segmented, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useWorkspaceMemosContextOptional } from "../../contexts/WorkspaceMemosContext";
import type { WorkspaceMemoScope } from "../../types/workspaceMemos";
import { InspectorCollapsibleSection } from "./InspectorCollapsibleSection";
import "./WorkspaceMemosPanel.css";

export interface WorkspaceMemosPanelProps {
  projectId: string | null;
  repositoryId: number | null;
}

function formatMemoTime(updatedAt: number): string {
  const date = new Date(updatedAt);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour12: false });
}

function WorkspaceMemosPanelFallback() {
  return (
    <section className="app-workspace-memos-panel app-workspace-memos-panel--list-only" aria-label="备忘录">
      <header className="app-workspace-memos-panel__head">
        <Typography.Text strong className="app-workspace-memos-panel__title">
          备忘录
        </Typography.Text>
      </header>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="备忘录上下文未就绪" />
    </section>
  );
}

function WorkspaceMemosPanelInner({ projectId, repositoryId }: WorkspaceMemosPanelProps) {
  const memos = useWorkspaceMemosContextOptional();
  const [newScope, setNewScope] = useState<WorkspaceMemoScope>("repository");

  if (!memos) {
    return <WorkspaceMemosPanelFallback />;
  }

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceMemoScope = allowRepositoryScope ? "repository" : "project";

  useEffect(() => {
    setNewScope(defaultNewScope);
  }, [defaultNewScope, projectId, repositoryId]);

  const newScopeOptions = [
    allowProjectScope ? { label: "工作区", value: "project" as const } : null,
    allowRepositoryScope ? { label: "仓库", value: "repository" as const } : null,
  ].filter((row): row is { label: string; value: WorkspaceMemoScope } => row != null);

  const createMemo = () => {
    const scope =
      allowProjectScope && allowRepositoryScope
        ? newScope
        : (newScopeOptions[0]?.value ?? defaultNewScope);
    const created = memos.createMemo(scope);
    if (created) {
    }
  };

  return (
    <InspectorCollapsibleSection
      sectionId="memos"
      className="app-workspace-memos-panel app-workspace-memos-panel--list-only"
      panelClassName="app-workspace-memos-panel"
      ariaLabel="备忘录"
      title="备忘录"
      headActions={
        <div className="app-workspace-memos-panel__head-actions">
          {newScopeOptions.length > 1 ? (
            <Segmented
              size="small"
              className="app-workspace-memos-panel__scope-pick"
              value={newScope}
              options={newScopeOptions}
              onChange={(value) => setNewScope(value as WorkspaceMemoScope)}
            />
          ) : null}
          <HoverHint title="新建并在主区打开">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              aria-label="新建备忘录"
              disabled={!memos.hasScope}
              onClick={createMemo}
            />
          </HoverHint>
        </div>
      }
    >
      <div className="app-workspace-memos-panel__body">
        {memos.loading ? (
          <div className="app-workspace-memos-panel__loading">
            <Spin size="small" />
          </div>
        ) : !memos.hasScope ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先在左侧选择工作区或仓库" />
        ) : memos.displayItems.length === 0 ? (
          <div className="app-workspace-memos-panel__list-empty">
            <Typography.Text type="secondary">暂无备忘录</Typography.Text>
            <Button type="link" size="small" icon={<PlusOutlined />} onClick={createMemo}>
              新建
            </Button>
          </div>
        ) : (
          <ul className="app-workspace-memos-panel__list">
            {memos.displayItems.map((item) => {
              const active =
                memos.selection?.scope === item.scope && memos.selection.id === item.id;
              const openInCenter =
                memos.activeSelection?.scope === item.scope &&
                memos.activeSelection.id === item.id;
              return (
                <li key={`${item.scope}:${item.id}`}>
                  <button
                    type="button"
                    className={`app-workspace-memos-panel__list-item${active ? " app-workspace-memos-panel__list-item--active" : ""}${openInCenter ? " app-workspace-memos-panel__list-item--open" : ""}`}
                    onClick={() => memos.openMemoInCenter({ scope: item.scope, id: item.id })}
                  >
                    <FileTextOutlined className="app-workspace-memos-panel__list-icon" />
                    <span className="app-workspace-memos-panel__list-title">{item.title}</span>
                    <span className="app-workspace-memos-panel__list-time">
                      {formatMemoTime(item.updatedAt)}
                    </span>
                    <Tag bordered={false} className="app-workspace-memos-panel__list-tag">
                      {item.scope === "project" ? "工作区" : "仓库"}
                    </Tag>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </InspectorCollapsibleSection>
  );
}

export function WorkspaceMemosPanel(props: WorkspaceMemosPanelProps) {
  return <WorkspaceMemosPanelInner {...props} />;
}
