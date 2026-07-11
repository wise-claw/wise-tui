import { Input, message, Modal } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WISE_WORKSPACE_TODOS_OPEN,
  type WorkspaceTodosOpenDetail,
} from "../../constants/workspaceTodosEvents";
import { appendGlobalWorkspaceTodoItem } from "../../services/workspaceTodosStore";

export function SidebarWorkspaceTodoAddModal({ enabled = true }: { enabled?: boolean }) {
  const [session, setSession] = useState<WorkspaceTodosOpenDetail | null>(null);
  const [pendingOpen, setPendingOpen] = useState<WorkspaceTodosOpenDetail | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

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
    if (!title || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    close();
    try {
      await appendGlobalWorkspaceTodoItem(title);
      message.success("待办已添加");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "待办事项保存失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [close, draftTitle]);

  const open = enabled && session != null;
  const canSubmit = Boolean(draftTitle.trim());

  if (!enabled) return null;

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
      width={400}
      className="app-sidebar-workspace-todo-add-modal"
    >
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
    </Modal>
  );
}
