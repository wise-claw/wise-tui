import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Segmented, Spin, Tag, Typography } from "antd";
import type { InputRef } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import {
  createWorkspaceTodoItem,
  formatWorkspaceTodoDueLabel,
  isWorkspaceTodoOverdue,
  type WorkspaceTodoDisplayItem,
  type WorkspaceTodoScope,
} from "../../types/workspaceTodos";
import { scopeItemsFromDisplay } from "../../utils/workspaceTodoDisplayItems";
import "./WorkspaceTodosPanel.css";

export type WorkspaceTodosController = ReturnType<typeof useWorkspaceTodos>;

export interface WorkspaceTodosEditorProps {
  projectId: string | null;
  repositoryId: number | null;
  todos?: WorkspaceTodosController;
  /** 无当前工作区/仓库时的占位文案 */
  emptyScopeHint?: string;
  showScopeTag?: boolean;
  showCompletedToggle?: boolean;
  showCompleted?: boolean;
  onShowCompletedChange?: (next: boolean) => void;
  /** 递增时聚焦「新建待办」输入框（侧栏菜单打开待办用） */
  focusAddToken?: number;
}

interface TodoRowProps {
  item: WorkspaceTodoDisplayItem;
  showScopeTag: boolean;
  onToggle: (item: WorkspaceTodoDisplayItem) => void;
  onTitleChange: (item: WorkspaceTodoDisplayItem, title: string) => void;
  onDelete: (item: WorkspaceTodoDisplayItem) => void;
}

function todoRowPropsEqual(prev: TodoRowProps, next: TodoRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.showScopeTag === next.showScopeTag &&
    prev.onToggle === next.onToggle &&
    prev.onTitleChange === next.onTitleChange &&
    prev.onDelete === next.onDelete
  );
}

const TodoRow = memo(function TodoRow({
  item,
  showScopeTag,
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

  const gridClass = showScopeTag
    ? "app-workspace-todos-panel__row"
    : "app-workspace-todos-panel__row app-workspace-todos-panel__row--no-scope";

  return (
    <li
      className={`${gridClass}${editing ? " app-workspace-todos-panel__row--editing" : ""}${item.completed ? " app-workspace-todos-panel__row--done" : ""}${overdue ? " app-workspace-todos-panel__row--overdue" : ""}`}
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
          <button
            type="button"
            className="app-workspace-todos-panel__title-btn"
            onClick={() => setEditing(true)}
          >
            {item.title}
          </button>
        )}
        {item.dueAt != null ? (
          <span className="app-workspace-todos-panel__due">{formatWorkspaceTodoDueLabel(item.dueAt)}</span>
        ) : null}
      </div>
      {showScopeTag ? (
        <Tag bordered={false} className="app-workspace-todos-panel__scope-tag">
          {item.scope === "project" ? "工作区" : "仓库"}
        </Tag>
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
    </li>
  );
}, todoRowPropsEqual);

interface WorkspaceTodosComposerProps {
  disabled: boolean;
  scopeOptions: Array<{ label: string; value: WorkspaceTodoScope }>;
  defaultScope: WorkspaceTodoScope;
  focusAddToken: number;
  onAdd: (title: string, scope: WorkspaceTodoScope) => void;
}

interface WorkspaceTodosListProps {
  activeItems: WorkspaceTodoDisplayItem[];
  completedItems: WorkspaceTodoDisplayItem[];
  showCompleted: boolean;
  showScopeTag: boolean;
  onToggle: (item: WorkspaceTodoDisplayItem) => void;
  onTitleChange: (item: WorkspaceTodoDisplayItem, title: string) => void;
  onDelete: (item: WorkspaceTodoDisplayItem) => void;
}

const WorkspaceTodosList = memo(function WorkspaceTodosList({
  activeItems,
  completedItems,
  showCompleted,
  showScopeTag,
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
          key={`${item.scope}:${item.id}`}
          item={item}
          showScopeTag={showScopeTag}
          onToggle={onToggle}
          onTitleChange={onTitleChange}
          onDelete={onDelete}
        />
      ))}
      {showCompleted
        ? completedItems.map((item) => (
            <TodoRow
              key={`${item.scope}:${item.id}`}
              item={item}
              showScopeTag={showScopeTag}
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
  scopeOptions,
  defaultScope,
  focusAddToken,
  onAdd,
}: WorkspaceTodosComposerProps) {
  const [newScope, setNewScope] = useState<WorkspaceTodoScope>(defaultScope);
  const [draftTitle, setDraftTitle] = useState("");
  const addInputRef = useRef<InputRef>(null);

  useEffect(() => {
    setNewScope(defaultScope);
  }, [defaultScope]);

  useEffect(() => {
    if (!focusAddToken || disabled) return;
    const timer = window.setTimeout(() => addInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [disabled, focusAddToken]);

  const resolvedScope = scopeOptions.length > 1 ? newScope : (scopeOptions[0]?.value ?? defaultScope);

  const commit = useCallback(
    (refocus: boolean) => {
      const title = draftTitle.trim();
      if (!title || disabled) return;
      onAdd(title, resolvedScope);
      setDraftTitle("");
      if (refocus) addInputRef.current?.focus();
    },
    [disabled, draftTitle, onAdd, resolvedScope],
  );

  return (
    <div className="app-workspace-todos-panel__composer">
      {scopeOptions.length > 1 ? (
        <Segmented
          size="small"
          className="app-workspace-todos-panel__scope-pick"
          value={newScope}
          options={scopeOptions}
          onChange={(value) => setNewScope(value as WorkspaceTodoScope)}
        />
      ) : null}
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
  projectId,
  repositoryId,
  todos: todosProp,
  emptyScopeHint = "请先在左侧选择工作区或仓库",
  showScopeTag: showScopeTagProp,
  showCompletedToggle = true,
  showCompleted: showCompletedProp,
  onShowCompletedChange,
  focusAddToken = 0,
}: WorkspaceTodosEditorProps) {
  const todosInternal = useWorkspaceTodos({
    projectId,
    repositoryId,
    enabled: todosProp == null,
  });
  const todos = todosProp ?? todosInternal;
  const displayItemsRef = useRef(todos.displayItems);
  const setItemsForScopeRef = useRef(todos.setItemsForScope);
  displayItemsRef.current = todos.displayItems;
  setItemsForScopeRef.current = todos.setItemsForScope;

  const [showCompletedInternal, setShowCompletedInternal] = useState(false);
  const showCompleted = showCompletedProp ?? showCompletedInternal;
  const setShowCompleted = onShowCompletedChange ?? setShowCompletedInternal;

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceTodoScope = allowRepositoryScope ? "repository" : "project";
  const showScopeTag =
    showScopeTagProp ?? (allowProjectScope && allowRepositoryScope);

  const newScopeOptions = useMemo(
    () =>
      [
        allowProjectScope ? { label: "工作区", value: "project" as const } : null,
        allowRepositoryScope ? { label: "仓库", value: "repository" as const } : null,
      ].filter((row): row is { label: string; value: WorkspaceTodoScope } => row != null),
    [allowProjectScope, allowRepositoryScope],
  );

  const { activeItems, completedItems } = useMemo(() => {
    const active: WorkspaceTodoDisplayItem[] = [];
    const completed: WorkspaceTodoDisplayItem[] = [];
    for (const item of todos.displayItems) {
      if (item.completed) completed.push(item);
      else active.push(item);
    }
    return { activeItems: active, completedItems: completed };
  }, [todos.displayItems]);

  const addTodo = useCallback((title: string, scope: WorkspaceTodoScope) => {
    const item = createWorkspaceTodoItem(title);
    const scopeRows = scopeItemsFromDisplay(displayItemsRef.current, scope);
    setItemsForScopeRef.current(scope, [...scopeRows, item]);
  }, []);

  const toggleTodo = useCallback((item: WorkspaceTodoDisplayItem) => {
    const now = Date.now();
    const scopeRows = scopeItemsFromDisplay(displayItemsRef.current, item.scope).map((row) =>
      row.id === item.id ? { ...row, completed: !row.completed, updatedAt: now } : row,
    );
    setItemsForScopeRef.current(item.scope, scopeRows);
  }, []);

  const updateTitle = useCallback((item: WorkspaceTodoDisplayItem, title: string) => {
    const now = Date.now();
    const scopeRows = scopeItemsFromDisplay(displayItemsRef.current, item.scope).map((row) =>
      row.id === item.id ? { ...row, title, updatedAt: now } : row,
    );
    setItemsForScopeRef.current(item.scope, scopeRows);
  }, []);

  const deleteTodo = useCallback((item: WorkspaceTodoDisplayItem) => {
    const scopeRows = scopeItemsFromDisplay(displayItemsRef.current, item.scope).filter(
      (row) => row.id !== item.id,
    );
    setItemsForScopeRef.current(item.scope, scopeRows);
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

  if (!todos.hasScope) {
    return (
      <div className="app-workspace-todos-panel__list-empty">
        <Typography.Text type="secondary">{emptyScopeHint}</Typography.Text>
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
        showScopeTag={showScopeTag}
        onToggle={toggleTodo}
        onTitleChange={updateTitle}
        onDelete={deleteTodo}
      />

      <WorkspaceTodosComposer
        disabled={!todos.hasScope}
        scopeOptions={newScopeOptions}
        defaultScope={defaultNewScope}
        focusAddToken={focusAddToken}
        onAdd={addTodo}
      />
    </>
  );
});
