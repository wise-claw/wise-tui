import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Spin, Typography } from "antd";
import type { InputRef } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import {
  createWorkspaceTodoItem,
  formatWorkspaceTodoDueLabel,
  isWorkspaceTodoOverdue,
  type WorkspaceTodoItem,
} from "../../types/workspaceTodos";
import "./WorkspaceTodosPanel.css";

export type WorkspaceTodosController = ReturnType<typeof useWorkspaceTodos>;

export interface WorkspaceTodosEditorProps {
  todos?: WorkspaceTodosController;
  showCompletedToggle?: boolean;
  showCompleted?: boolean;
  onShowCompletedChange?: (next: boolean) => void;
  /** 递增时聚焦「新建待办」输入框（侧栏菜单打开待办用） */
  focusAddToken?: number;
}

interface TodoRowProps {
  item: WorkspaceTodoItem;
  onToggle: (item: WorkspaceTodoItem) => void;
  onTitleChange: (item: WorkspaceTodoItem, title: string) => void;
  onDelete: (item: WorkspaceTodoItem) => void;
}

function todoRowPropsEqual(prev: TodoRowProps, next: TodoRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.onToggle === next.onToggle &&
    prev.onTitleChange === next.onTitleChange &&
    prev.onDelete === next.onDelete
  );
}

const TodoRow = memo(function TodoRow({
  item,
  onToggle,
  onTitleChange,
  onDelete,
}: TodoRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const overdue = isWorkspaceTodoOverdue(item);

  useEffect(() => {
    if (!editing) setDraft(item.title);
  }, [item.title, editing]);

  const commitTitle = () => {
    const next = draft.trim() || "无标题";
    setEditing(false);
    if (next !== item.title) onTitleChange(item, next);
  };

  return (
    <li
      className={`app-workspace-todos-panel__row app-workspace-todos-panel__row--no-scope${editing ? " app-workspace-todos-panel__row--editing" : ""}${item.completed ? " app-workspace-todos-panel__row--done" : ""}${overdue ? " app-workspace-todos-panel__row--overdue" : ""}`}
    >
      <Checkbox
        className="app-workspace-todos-panel__check"
        checked={item.completed}
        onChange={() => onToggle(item)}
        aria-label={item.completed ? "标记为未完成" : "标记为已完成"}
      />
      <div className="app-workspace-todos-panel__row-main">
        {editing ? (
          <Input
            size="small"
            className="app-workspace-todos-panel__title-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onPressEnter={(e) => {
              e.preventDefault();
              commitTitle();
            }}
          />
        ) : (
          <span className="app-workspace-todos-panel__title-text">{item.title}</span>
        )}
        {item.dueAt != null ? (
          <span className="app-workspace-todos-panel__due">{formatWorkspaceTodoDueLabel(item.dueAt)}</span>
        ) : null}
      </div>
      <div className="app-workspace-todos-panel__row-actions">
        {!editing ? (
          <Button
            type="text"
            size="small"
            className="app-workspace-todos-panel__edit"
            icon={<EditOutlined />}
            aria-label="编辑待办"
            title="编辑"
            onClick={() => setEditing(true)}
          />
        ) : null}
        <Button
          type="text"
          size="small"
          className="app-workspace-todos-panel__delete"
          icon={<DeleteOutlined />}
          aria-label="删除待办"
          title="删除"
          onClick={() => onDelete(item)}
        />
      </div>
    </li>
  );
}, todoRowPropsEqual);

interface WorkspaceTodosComposerProps {
  disabled: boolean;
  focusAddToken: number;
  onAdd: (title: string) => void;
}

interface WorkspaceTodosListProps {
  activeItems: WorkspaceTodoItem[];
  completedItems: WorkspaceTodoItem[];
  showCompleted: boolean;
  onToggle: (item: WorkspaceTodoItem) => void;
  onTitleChange: (item: WorkspaceTodoItem, title: string) => void;
  onDelete: (item: WorkspaceTodoItem) => void;
}

const WorkspaceTodosList = memo(function WorkspaceTodosList({
  activeItems,
  completedItems,
  showCompleted,
  onToggle,
  onTitleChange,
  onDelete,
}: WorkspaceTodosListProps) {
  return (
    <ul className="app-workspace-todos-panel__list">
      {activeItems.length === 0 && !showCompleted ? (
        <li className="app-workspace-todos-panel__empty-hint">
          <Typography.Text type="secondary">暂无待办</Typography.Text>
        </li>
      ) : null}
      {activeItems.map((item) => (
        <TodoRow
          key={item.id}
          item={item}
          onToggle={onToggle}
          onTitleChange={onTitleChange}
          onDelete={onDelete}
        />
      ))}
      {showCompleted
        ? completedItems.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              onToggle={onToggle}
              onTitleChange={onTitleChange}
              onDelete={onDelete}
            />
          ))
        : null}
    </ul>
  );
});

const WorkspaceTodosComposer = memo(function WorkspaceTodosComposer({
  disabled,
  focusAddToken,
  onAdd,
}: WorkspaceTodosComposerProps) {
  const [draftTitle, setDraftTitle] = useState("");
  const addInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!focusAddToken || disabled) return;
    const timer = window.setTimeout(() => addInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [disabled, focusAddToken]);

  const commit = useCallback(
    (refocus: boolean) => {
      const title = draftTitle.trim();
      if (!title || disabled) return;
      onAdd(title);
      setDraftTitle("");
      if (refocus) addInputRef.current?.focus();
    },
    [disabled, draftTitle, onAdd],
  );

  return (
    <div className="app-workspace-todos-panel__composer">
      <Input
        ref={addInputRef}
        size="small"
        className="app-workspace-todos-panel__add-input"
        placeholder="新建待办"
        value={draftTitle}
        disabled={disabled}
        onChange={(e) => setDraftTitle(e.target.value)}
        onPressEnter={(e) => {
          e.preventDefault();
          commit(true);
        }}
      />
      <Button
        type="text"
        size="small"
        icon={<PlusOutlined />}
        aria-label="添加待办"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit(true)}
      />
    </div>
  );
});

export const WorkspaceTodosEditor = memo(function WorkspaceTodosEditor({
  todos: todosProp,
  showCompletedToggle = true,
  showCompleted: showCompletedProp,
  onShowCompletedChange,
  focusAddToken = 0,
}: WorkspaceTodosEditorProps) {
  const todosInternal = useWorkspaceTodos({ enabled: todosProp == null });
  const todos = todosProp ?? todosInternal;
  const itemsRef = useRef(todos.items);
  const setItemsRef = useRef(todos.setItems);
  itemsRef.current = todos.items;
  setItemsRef.current = todos.setItems;

  const [showCompletedInternal, setShowCompletedInternal] = useState(false);
  const showCompleted = showCompletedProp ?? showCompletedInternal;
  const setShowCompleted = onShowCompletedChange ?? setShowCompletedInternal;

  const { activeItems, completedItems } = useMemo(() => {
    const active: WorkspaceTodoItem[] = [];
    const completed: WorkspaceTodoItem[] = [];
    for (const item of todos.items) {
      if (item.completed) completed.push(item);
      else active.push(item);
    }
    return { activeItems: active, completedItems: completed };
  }, [todos.items]);

  const addTodo = useCallback((title: string) => {
    const item = createWorkspaceTodoItem(title);
    setItemsRef.current([...itemsRef.current, item]);
  }, []);

  const toggleTodo = useCallback((item: WorkspaceTodoItem) => {
    const now = Date.now();
    setItemsRef.current(
      itemsRef.current.map((row) =>
        row.id === item.id ? { ...row, completed: !row.completed, updatedAt: now } : row,
      ),
    );
  }, []);

  const updateTitle = useCallback((item: WorkspaceTodoItem, title: string) => {
    const now = Date.now();
    setItemsRef.current(
      itemsRef.current.map((row) =>
        row.id === item.id ? { ...row, title, updatedAt: now } : row,
      ),
    );
  }, []);

  const deleteTodo = useCallback((item: WorkspaceTodoItem) => {
    setItemsRef.current(itemsRef.current.filter((row) => row.id !== item.id));
  }, []);

  const completedToggle =
    showCompletedToggle && completedItems.length > 0 ? (
      <div className="app-workspace-todos-panel__head-actions app-workspace-todos-editor__done-toggle">
        <Button
          type="link"
          size="small"
          className="app-workspace-todos-panel__toggle-done"
          onClick={() => setShowCompleted(!showCompleted)}
        >
          {showCompleted ? "隐藏已完成" : `已完成 ${completedItems.length}`}
        </Button>
      </div>
    ) : null;

  if (todos.loading) {
    return (
      <div className="app-workspace-todos-panel__loading">
        <Spin size="small" />
      </div>
    );
  }

  return (
    <>
      {completedToggle}
      <WorkspaceTodosList
        activeItems={activeItems}
        completedItems={completedItems}
        showCompleted={showCompleted}
        onToggle={toggleTodo}
        onTitleChange={updateTitle}
        onDelete={deleteTodo}
      />

      <WorkspaceTodosComposer
        disabled={!todos.hasScope}
        focusAddToken={focusAddToken}
        onAdd={addTodo}
      />
    </>
  );
});
