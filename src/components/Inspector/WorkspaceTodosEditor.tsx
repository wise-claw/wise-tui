import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Segmented, Spin, Tag, Tooltip, Typography } from "antd";
import type { InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import {
  createWorkspaceTodoItem,
  formatWorkspaceTodoDueLabel,
  isWorkspaceTodoOverdue,
  type WorkspaceTodoDisplayItem,
  type WorkspaceTodoScope,
} from "../../types/workspaceTodos";
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
  onToggle: () => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}

function TodoRow({ item, showScopeTag, onToggle, onTitleChange, onDelete }: TodoRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const overdue = isWorkspaceTodoOverdue(item);

  useEffect(() => {
    if (!editing) setDraft(item.title);
  }, [item.title, editing]);

  const commitTitle = () => {
    const next = draft.trim() || "无标题";
    setEditing(false);
    if (next !== item.title) onTitleChange(next);
  };

  const gridClass = showScopeTag
    ? "app-workspace-todos-panel__row"
    : "app-workspace-todos-panel__row app-workspace-todos-panel__row--no-scope";

  return (
    <li
      className={`${gridClass}${item.completed ? " app-workspace-todos-panel__row--done" : ""}${overdue ? " app-workspace-todos-panel__row--overdue" : ""}`}
    >
      <Checkbox
        className="app-workspace-todos-panel__check"
        checked={item.completed}
        onChange={onToggle}
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
            onPressEnter={commitTitle}
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
      <Tooltip title="删除" placement="topRight" mouseEnterDelay={0.3}>
        <Button
          type="text"
          size="small"
          className="app-workspace-todos-panel__delete"
          icon={<DeleteOutlined />}
          aria-label="删除待办"
          onClick={onDelete}
        />
      </Tooltip>
    </li>
  );
}

export function WorkspaceTodosEditor({
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
  const todosInternal = useWorkspaceTodos({ projectId, repositoryId });
  const todos = todosProp ?? todosInternal;
  const [newScope, setNewScope] = useState<WorkspaceTodoScope>("repository");
  const [draftTitle, setDraftTitle] = useState("");
  const [showCompletedInternal, setShowCompletedInternal] = useState(false);
  const showCompleted = showCompletedProp ?? showCompletedInternal;
  const setShowCompleted = onShowCompletedChange ?? setShowCompletedInternal;
  const addInputRef = useRef<InputRef>(null);

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceTodoScope = allowRepositoryScope ? "repository" : "project";
  const showScopeTag =
    showScopeTagProp ?? (allowProjectScope && allowRepositoryScope);

  useEffect(() => {
    setNewScope(defaultNewScope);
  }, [defaultNewScope, projectId, repositoryId]);

  useEffect(() => {
    if (!focusAddToken || todos.loading || !todos.hasScope) return;
    const timer = window.setTimeout(() => addInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [focusAddToken, todos.loading, todos.hasScope]);

  const newScopeOptions = [
    allowProjectScope ? { label: "工作区", value: "project" as const } : null,
    allowRepositoryScope ? { label: "仓库", value: "repository" as const } : null,
  ].filter((row): row is { label: string; value: WorkspaceTodoScope } => row != null);

  const { activeItems, completedItems } = useMemo(() => {
    const active: WorkspaceTodoDisplayItem[] = [];
    const completed: WorkspaceTodoDisplayItem[] = [];
    for (const item of todos.displayItems) {
      if (item.completed) completed.push(item);
      else active.push(item);
    }
    return { activeItems: active, completedItems: completed };
  }, [todos.displayItems]);

  const getScopeItems = (scope: WorkspaceTodoScope) =>
    todos.displayItems.filter((row) => row.scope === scope).map(({ scope: _s, ...rest }) => rest);

  const commitNewTodo = (refocus = false) => {
    const title = draftTitle.trim();
    if (!title) return;
    const scope =
      allowProjectScope && allowRepositoryScope
        ? newScope
        : (newScopeOptions[0]?.value ?? defaultNewScope);
    const item = createWorkspaceTodoItem(title);
    todos.setItemsForScope(scope, [...getScopeItems(scope), item]);
    setDraftTitle("");
    if (refocus) addInputRef.current?.focus();
  };

  const toggleTodo = (item: WorkspaceTodoDisplayItem) => {
    const now = Date.now();
    const scopeRows = getScopeItems(item.scope).map((row) =>
      row.id === item.id
        ? { ...row, completed: !row.completed, updatedAt: now }
        : row,
    );
    todos.setItemsForScope(item.scope, scopeRows);
  };

  const updateTitle = (item: WorkspaceTodoDisplayItem, title: string) => {
    const now = Date.now();
    const scopeRows = getScopeItems(item.scope).map((row) =>
      row.id === item.id ? { ...row, title, updatedAt: now } : row,
    );
    todos.setItemsForScope(item.scope, scopeRows);
  };

  const deleteTodo = (item: WorkspaceTodoDisplayItem) => {
    const scopeRows = getScopeItems(item.scope).filter((row) => row.id !== item.id);
    todos.setItemsForScope(item.scope, scopeRows);
  };

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
            onToggle={() => toggleTodo(item)}
            onTitleChange={(title) => updateTitle(item, title)}
            onDelete={() => deleteTodo(item)}
          />
        ))}
        {showCompleted
          ? completedItems.map((item) => (
              <TodoRow
                key={`${item.scope}:${item.id}`}
                item={item}
                showScopeTag={showScopeTag}
                onToggle={() => toggleTodo(item)}
                onTitleChange={(title) => updateTitle(item, title)}
                onDelete={() => deleteTodo(item)}
              />
            ))
          : null}
      </ul>

      <div className="app-workspace-todos-panel__composer">
        {newScopeOptions.length > 1 ? (
          <Segmented
            size="small"
            className="app-workspace-todos-panel__scope-pick"
            value={newScope}
            options={newScopeOptions}
            onChange={(value) => setNewScope(value as WorkspaceTodoScope)}
          />
        ) : null}
        <Input
          ref={addInputRef}
          size="small"
          className="app-workspace-todos-panel__add-input"
          placeholder="新建待办"
          value={draftTitle}
          disabled={!todos.hasScope}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={() => commitNewTodo(false)}
        />
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          aria-label="添加待办"
          disabled={!todos.hasScope}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commitNewTodo(true)}
        />
      </div>
    </>
  );
}
