import { Input, Modal, Segmented, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WISE_WORKSPACE_TODOS_OPEN,
  type WorkspaceTodosOpenDetail,
} from "../../constants/workspaceTodosEvents";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import {
  createWorkspaceTodoItem,
  type WorkspaceTodoItem,
  type WorkspaceTodoScope,
} from "../../types/workspaceTodos";

function modalTitle(projectId: string | null, repositoryId: number | null): string {
  if (repositoryId != null && projectId?.trim()) return "添加待办事项";
  if (repositoryId != null) return "添加仓库待办";
  if (projectId?.trim()) return "添加工作区待办";
  return "添加待办事项";
}

function scopeHint(scope: WorkspaceTodoScope): string {
  return scope === "project" ? "保存到当前工作区" : "保存到当前仓库";
}

export function SidebarWorkspaceTodoAddModal({ enabled = true }: { enabled?: boolean }) {
  const [session, setSession] = useState<WorkspaceTodosOpenDetail | null>(null);
  const [pendingOpen, setPendingOpen] = useState<WorkspaceTodosOpenDetail | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [newScope, setNewScope] = useState<WorkspaceTodoScope>("repository");
  const [submitting, setSubmitting] = useState(false);

  const projectId = session?.projectId ?? null;
  const repositoryId = session?.repositoryId ?? null;
  const todos = useWorkspaceTodos({
    projectId,
    repositoryId,
    enabled: enabled && session != null,
  });

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceTodoScope = allowRepositoryScope ? "repository" : "project";

  const scopeOptions = useMemo(
    () =>
      [
        allowProjectScope ? { label: "工作区", value: "project" as const } : null,
        allowRepositoryScope ? { label: "仓库", value: "repository" as const } : null,
      ].filter((row): row is { label: string; value: WorkspaceTodoScope } => row != null),
    [allowProjectScope, allowRepositoryScope],
  );

  const resolvedScope =
    allowProjectScope && allowRepositoryScope
      ? newScope
      : (scopeOptions[0]?.value ?? defaultNewScope);

  useEffect(() => {
    setNewScope(defaultNewScope);
  }, [defaultNewScope, session?.projectId, session?.repositoryId]);

  const close = useCallback(() => {
    setSession(null);
    setDraftTitle("");
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceTodosOpenDetail>).detail;
      if (!detail || detail.surface !== "modal") return;
      setPendingOpen(detail);
    };
    window.addEventListener(WISE_WORKSPACE_TODOS_OPEN, onOpen);
    return () => window.removeEventListener(WISE_WORKSPACE_TODOS_OPEN, onOpen);
  }, [enabled]);

  useEffect(() => {
    if (!pendingOpen) return;
    setSession(pendingOpen);
    setDraftTitle("");
    setSubmitting(false);
    setPendingOpen(null);
  }, [pendingOpen]);

  const getScopeItems = useCallback(
    (scope: WorkspaceTodoScope): WorkspaceTodoItem[] => {
      if (scope === "project") {
        return todos.displayItems.filter((row) => row.scope === "project").map(({ scope: _s, ...rest }) => rest);
      }
      return todos.displayItems.filter((row) => row.scope === "repository").map(({ scope: _s, ...rest }) => rest);
    },
    [todos.displayItems],
  );

  const commit = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title || !todos.hasScope || submitting) return;
    setSubmitting(true);
    try {
      const item = createWorkspaceTodoItem(title);
      todos.setItemsForScope(resolvedScope, [...getScopeItems(resolvedScope), item]);
      close();
    } finally {
      setSubmitting(false);
    }
  }, [close, draftTitle, getScopeItems, resolvedScope, submitting, todos]);

  const open = enabled && session != null && todos.hasScope;
  const title = session ? modalTitle(projectId, repositoryId) : "添加待办事项";

  if (!enabled) return null;

  return (
    <Modal
      title={title}
      open={open}
      onCancel={close}
      onOk={() => void commit()}
      okText="添加"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !draftTitle.trim() || todos.loading }}
      destroyOnHidden
      width={400}
      className="app-sidebar-workspace-todo-add-modal"
    >
      {todos.loading ? (
        <Typography.Text type="secondary">加载中…</Typography.Text>
      ) : (
        <>
          {scopeOptions.length > 1 ? (
            <div className="app-sidebar-workspace-todo-add-modal__scope">
              <Segmented
                size="small"
                block
                value={resolvedScope}
                options={scopeOptions}
                onChange={(value) => setNewScope(value as WorkspaceTodoScope)}
              />
              <Typography.Text type="secondary" className="app-sidebar-workspace-todo-add-modal__scope-hint">
                {scopeHint(resolvedScope)}
              </Typography.Text>
            </div>
          ) : (
            <Typography.Paragraph type="secondary" className="app-sidebar-workspace-todo-add-modal__intro">
              {scopeHint(resolvedScope)}
            </Typography.Paragraph>
          )}
          <Input
            placeholder="输入待办标题"
            value={draftTitle}
            maxLength={200}
            showCount
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onPressEnter={() => void commit()}
          />
        </>
      )}
    </Modal>
  );
}
