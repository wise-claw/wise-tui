import { Input, message, Modal, Segmented, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WISE_WORKSPACE_TODOS_OPEN,
  type WorkspaceTodosOpenDetail,
} from "../../constants/workspaceTodosEvents";
import { appendWorkspaceTodoItem } from "../../services/workspaceTodosStore";
import type { WorkspaceTodoScope } from "../../types/workspaceTodos";

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
  const submittingRef = useRef(false);

  const projectId = session?.projectId ?? null;
  const repositoryId = session?.repositoryId ?? null;

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceTodoScope = allowRepositoryScope ? "repository" : "project";
  const hasScope = allowProjectScope || allowRepositoryScope;

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
    submittingRef.current = false;
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
    submittingRef.current = false;
    setSubmitting(false);
    setPendingOpen(null);
  }, [pendingOpen]);

  const commit = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title || !hasScope || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    close();
    try {
      if (resolvedScope === "project") {
        await appendWorkspaceTodoItem({
          scope: "project",
          projectId,
          title,
        });
      } else {
        await appendWorkspaceTodoItem({
          scope: "repository",
          repositoryId,
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
  }, [close, draftTitle, hasScope, projectId, repositoryId, resolvedScope]);

  const open = enabled && session != null && hasScope;
  const title = session ? modalTitle(projectId, repositoryId) : "添加待办事项";
  const canSubmit = Boolean(draftTitle.trim() && hasScope);

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
      okButtonProps={{ disabled: !canSubmit || submitting }}
      destroyOnHidden
      width={400}
      className="app-sidebar-workspace-todo-add-modal"
    >
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
          onPressEnter={(event) => {
            event.preventDefault();
            void commit();
          }}
        />
      </>
    </Modal>
  );
}
