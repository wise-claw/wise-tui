import { Input, message, Modal, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendWorkspaceTodoItem } from "../../services/workspaceTodosStore";
import type { Repository, Workspace } from "../../types";
import { parseWorkspaceRepositoryTreeValue } from "../../utils/workspaceRepositoryTreeSelect";
import type { WorkspaceRepositoryTreeNode } from "../../utils/workspaceRepositoryTreeSelect";
import {
  buildWorkspaceTodoTargetTree,
  resolveDefaultWorkspaceTodoTreeKey,
} from "../../utils/workspaceTodoTargetOptions";

export interface SidebarGlobalWorkspaceTodoAddModalProps {
  enabled?: boolean;
  open: boolean;
  onClose: () => void;
  projects: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
}

function toAntTreeData(nodes: readonly WorkspaceRepositoryTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.value,
    title: node.title,
    selectable: node.selectable,
    disabled: !node.selectable,
    children: node.children ? toAntTreeData(node.children) : undefined,
  }));
}

export function SidebarGlobalWorkspaceTodoAddModal({
  enabled = true,
  open,
  onClose,
  projects,
  repositoriesById,
  floatingRepositories: _floatingRepositories,
  activeProjectId,
  activeRepositoryId,
}: SidebarGlobalWorkspaceTodoAddModalProps) {
  const [draftTitle, setDraftTitle] = useState("");
  const [selectedTreeKey, setSelectedTreeKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const prevOpenRef = useRef(false);

  const treeData = useMemo(() => {
    if (!open) return [];
    const repositories = [...repositoriesById.values()];
    return toAntTreeData(buildWorkspaceTodoTargetTree(projects, repositories));
  }, [open, projects, repositoriesById]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    const repositories = [...repositoriesById.values()];
    const treeNodes = buildWorkspaceTodoTargetTree(projects, repositories);
    setDraftTitle("");
    setSelectedTreeKey(
      resolveDefaultWorkspaceTodoTreeKey({
        treeNodes,
        activeProjectId,
        activeRepositoryId,
      }),
    );
    submittingRef.current = false;
    setSubmitting(false);
  }, [open, projects, repositoriesById, activeProjectId, activeRepositoryId]);

  const close = useCallback(() => {
    onClose();
    submittingRef.current = false;
    setSubmitting(false);
  }, [onClose]);

  const commit = useCallback(async () => {
    const title = draftTitle.trim();
    const parsed = parseWorkspaceRepositoryTreeValue(selectedTreeKey ?? "");
    if (!title || !parsed || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    close();
    try {
      if (parsed.kind === "project") {
        await appendWorkspaceTodoItem({
          scope: "project",
          projectId: parsed.projectId,
          title,
        });
      } else {
        await appendWorkspaceTodoItem({
          scope: "repository",
          repositoryId: parsed.repositoryId,
          title,
        });
      }
      message.success("待办已添加");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "待办事项保存失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [close, draftTitle, selectedTreeKey]);

  if (!enabled) return null;

  const hasTarget = treeData.length > 0;
  const canSubmit = Boolean(draftTitle.trim() && selectedTreeKey && hasTarget);

  return (
    <Modal
      title="添加待办事项"
      open={open}
      onCancel={close}
      onOk={() => void commit()}
      okText="添加"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !canSubmit || submitting }}
      destroyOnHidden
      width={420}
      className="app-sidebar-global-workspace-todo-add-modal"
    >
      {!hasTarget ? (
        <Typography.Text type="secondary">当前没有可保存的工作区或仓库。</Typography.Text>
      ) : (
        <>
          <div className="app-sidebar-global-workspace-todo-add-modal__field">
            <Typography.Text className="app-sidebar-global-workspace-todo-add-modal__label">
              待办标题
            </Typography.Text>
            <Input
              placeholder="输入待办标题"
              value={draftTitle}
              maxLength={200}
              showCount
              autoFocus
              onChange={(event) => setDraftTitle(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault();
                void commit();
              }}
            />
          </div>
          <div className="app-sidebar-global-workspace-todo-add-modal__field">
            <Typography.Text className="app-sidebar-global-workspace-todo-add-modal__label">
              保存到
            </Typography.Text>
            <Tree
              className="app-sidebar-global-workspace-todo-add-modal__tree"
              blockNode
              showLine
              defaultExpandAll
              selectedKeys={selectedTreeKey ? [selectedTreeKey] : []}
              treeData={treeData}
              onSelect={(keys) => {
                if (keys.length === 0) return;
                const next = String(keys[0] ?? "");
                if (!parseWorkspaceRepositoryTreeValue(next)) return;
                setSelectedTreeKey(next);
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
