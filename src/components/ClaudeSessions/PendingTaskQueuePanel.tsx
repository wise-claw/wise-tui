import { MoreOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dropdown, Input, Modal, message, type MenuProps } from "antd";
import type { PendingExecutionTask } from "../../types";

// ── Icons ──

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 17v5M5 17h14l-1-7H6l-1 7zM9 10V3h6v7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}

/** 收起列表：上箭头 */
function IconCollapseList() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 展开列表：下箭头 */
function IconExpandList() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Types ──

interface Props {
  sessionStatus: "idle" | "connecting" | "running" | "completed" | "cancelled" | "error";
  tasks: PendingExecutionTask[];
  /** 已预约在本轮 Claude 结束后自动发送队首 */
  deferredSendQueued?: boolean;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, fields: Partial<Pick<PendingExecutionTask, "promptText" | "executorLabel">>) => void;
  taskDispatchStateById?: Record<string, { label: string; tone: "ready" | "waiting" }>;
  onSendNext: () => void;
  onClearAll: () => void;
}

// ── Main ──

export function PendingTaskQueuePanel({
  sessionStatus,
  tasks,
  deferredSendQueued = false,
  onPin,
  onRemove,
  onUpdate,
  taskDispatchStateById = {},
  onSendNext,
  onClearAll,
}: Props) {
  const [listCollapsed, setListCollapsed] = useState(false);
  const prevTaskCountRef = useRef(tasks.length);
  const [editing, setEditing] = useState<PendingExecutionTask | null>(null);
  const [editText, setEditText] = useState("");
  const [editExecutor, setEditExecutor] = useState("");

  const isRunning = sessionStatus === "running";

  useEffect(() => {
    const prev = prevTaskCountRef.current;
    prevTaskCountRef.current = tasks.length;
    if (tasks.length > prev && tasks.length > 0) {
      setListCollapsed(false);
    }
  }, [tasks.length]);

  const openEdit = useCallback((t: PendingExecutionTask) => {
    setEditing(t);
    setEditText(t.promptText);
    setEditExecutor(t.executorLabel);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const text = editText.trim();
    if (!text) {
      message.warning("任务内容不能为空");
      return;
    }
    onUpdate(editing.id, { promptText: text, executorLabel: editExecutor.trim() || "未指定" });
    setEditing(null);
  }, [editing, editText, editExecutor, onUpdate]);

  const multitaskItems: MenuProps["items"] = [
    {
      key: "send-next",
      label: isRunning ? "本轮结束后发送下一项" : "发送下一项",
      disabled: tasks.length === 0,
    },
    {
      key: "clear",
      label: "清空队列",
      danger: true,
      disabled: tasks.length === 0,
    },
  ];

  const onMultitaskClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "send-next") {
      onSendNext();
      return;
    }
    if (key === "clear") {
      Modal.confirm({
        title: "清空待执行队列？",
        content: "将移除本会话已排队的所有任务（不可恢复）。",
        okText: "清空",
        okType: "danger",
        cancelText: "取消",
        onOk: () => {
          onClearAll();
        },
      });
    }
  };

  const count = tasks.length;
  const headTask = tasks[0];
  const headDispatchState = headTask ? taskDispatchStateById[headTask.id] : undefined;
  const headDispatchHint =
    headDispatchState?.tone === "waiting" ? `队首阻塞：${headDispatchState.label}` : headDispatchState?.label ?? "";

  const headRight = (
    <div className="app-pending-task-queue-panel__head-right">
      {deferredSendQueued ? (
        <span className="app-pending-task-queue-panel__deferred-tag" title="已预约本轮结束后自动发送队首">
          本轮后发送
        </span>
      ) : null}
      <Dropdown menu={{ items: multitaskItems, onClick: onMultitaskClick }} trigger={["click"]} placement="bottomRight">
        <Button type="text" size="small" icon={<MoreOutlined />} className="app-pending-task-queue-more-btn" aria-label="更多操作" />
      </Dropdown>
      {listCollapsed ? (
        <button
          type="button"
          className="app-pending-task-queue-panel__toggle-list-btn"
          aria-label="展开"
          title="展开"
          onClick={() => setListCollapsed(false)}
        >
          <IconExpandList />
        </button>
      ) : (
        <button
          type="button"
          className="app-pending-task-queue-panel__toggle-list-btn"
          aria-label="收起"
          title="收起"
          onClick={() => setListCollapsed(true)}
        >
          <IconCollapseList />
        </button>
      )}
    </div>
  );

  const headLeft = (
    <div className="app-pending-task-queue-panel__head-left">
      <span className="app-pending-task-queue-panel__title">{count} 项排队</span>
      {headDispatchHint ? (
        <span
          className={`app-pending-task-queue-panel__head-hint app-pending-task-queue-panel__head-hint--${headDispatchState?.tone ?? "ready"}`}
          title={headDispatchHint}
        >
          {headDispatchHint}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="app-pending-task-queue-inner">
      {count > 0 ? (
        <div
          className={`app-pending-task-queue-panel${listCollapsed ? " app-pending-task-queue-panel--list-collapsed" : ""}`}
          role="region"
          aria-label="待办任务队列"
        >
          <div className="app-pending-task-queue-panel__head">
            {headLeft}
            {headRight}
          </div>
          {!listCollapsed ? (
            <ul className="app-pending-task-queue-panel__list">
              {tasks.map((t) => (
                <li key={t.id} className="app-pending-task-queue-panel__item">
                  <div className="app-pending-task-queue-panel__item-main">
                    <span className="app-pending-task-queue-panel__executor" title={t.executorLabel}>
                      {t.executorLabel}
                    </span>
                    {taskDispatchStateById[t.id] ? (
                      <span
                        className={`app-pending-task-queue-panel__dispatch-state app-pending-task-queue-panel__dispatch-state--${taskDispatchStateById[t.id]!.tone}`}
                        title={taskDispatchStateById[t.id]!.label}
                      >
                        {taskDispatchStateById[t.id]!.label}
                      </span>
                    ) : null}
                    <span className="app-pending-task-queue-panel__text" title={t.promptText}>
                      {t.promptText}
                    </span>
                  </div>
                  <div className="app-pending-task-queue-panel__actions">
                    <button type="button" className="app-pending-task-queue-icon-btn" title="编辑" onClick={() => openEdit(t)}>
                      <IconEdit />
                    </button>
                    <button type="button" className="app-pending-task-queue-icon-btn" title="置顶" onClick={() => onPin(t.id)}>
                      <IconPin />
                    </button>
                    <button type="button" className="app-pending-task-queue-icon-btn" title="删除" onClick={() => onRemove(t.id)}>
                      <IconTrash />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Modal
        title="编辑排队任务"
        open={editing != null}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        destroyOnHidden
        width={560}
      >
        <div className="app-pending-task-queue-edit">
          <label className="app-pending-task-queue-edit__label">由谁执行（展示）</label>
          <Input value={editExecutor} onChange={(e) => setEditExecutor(e.target.value)} placeholder="例如 @张三 或 Sonnet" />
          <label className="app-pending-task-queue-edit__label">任务内容</label>
          <Input.TextArea value={editText} onChange={(e) => setEditText(e.target.value)} rows={8} />
        </div>
      </Modal>
    </div>
  );
}
