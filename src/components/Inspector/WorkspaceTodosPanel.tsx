import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Segmented, Spin, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import {
  createWorkspaceTodoId,
  formatWorkspaceTodoDueLabel,
  isWorkspaceTodoOverdue,
  type WorkspaceTodoDisplayItem,
  type WorkspaceTodoScope,
} from "../../types/workspaceTodos";
import "./WorkspaceTodosPanel.css";

export interface WorkspaceTodosPanelProps {
  projectId: string | null;
  repositoryId: number | null;
}

interface TodoRowProps {
  item: WorkspaceTodoDisplayItem;
  onToggle: () => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}

function TodoRow({ item, onToggle, onTitleChange, onDelete }: TodoRowProps) {
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

  return (
    <li
      className={`app-workspace-todos-panel__row${item.completed ? " app-workspace-todos-panel__row--done" : ""}${overdue ? " app-workspace-todos-panel__row--overdue" : ""}`}
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
      <Tag bordered={false} className="app-workspace-todos-panel__scope-tag">
        {item.scope === "project" ? "工作区" : "仓库"}
      </Tag>
      <Tooltip title="删除" placement="topRight" mouseEnterDelay={0.3}>
        <Button
          type="text"
          size="small"
          className="app-workspace-todos-panel__delete"
          icon={<DeleteOutlined />}
          aria-label="删除提醒"
          onClick={onDelete}
        />
      </Tooltip>
    </li>
  );
}

export function WorkspaceTodosPanel({ projectId, repositoryId }: WorkspaceTodosPanelProps) {
  const { message } = App.useApp();
  const todos = useWorkspaceTodos({ projectId, repositoryId });
  const [newScope, setNewScope] = useState<WorkspaceTodoScope>("repository");
  const [draftTitle, setDraftTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const allowProjectScope = Boolean(projectId?.trim());
  const allowRepositoryScope = repositoryId != null;
  const defaultNewScope: WorkspaceTodoScope = allowRepositoryScope ? "repository" : "project";

  useEffect(() => {
    setNewScope(defaultNewScope);
  }, [defaultNewScope, projectId, repositoryId]);

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

  const addTodo = () => {
    const title = draftTitle.trim();
    if (!title) {
      addInputRef.current?.focus();
      return;
    }
    const scope =
      allowProjectScope && allowRepositoryScope
        ? newScope
        : (newScopeOptions[0]?.value ?? defaultNewScope);
    const now = Date.now();
    const item = {
      id: createWorkspaceTodoId(),
      title,
      completed: false,
      dueAt: null,
      notes: "",
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
    };
    todos.setItemsForScope(scope, [...getScopeItems(scope), item]);
    setDraftTitle("");
    message.success("已添加提醒");
    addInputRef.current?.focus();
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

  return (
    <section className="app-workspace-todos-panel" aria-label="提醒事项">
      <header className="app-workspace-todos-panel__head">
        <Typography.Text strong className="app-workspace-todos-panel__title">
          提醒事项
        </Typography.Text>
        <div className="app-workspace-todos-panel__head-actions">
          {completedItems.length > 0 ? (
            <Button
              type="link"
              size="small"
              className="app-workspace-todos-panel__toggle-done"
              onClick={() => setShowCompleted((value) => !value)}
            >
              {showCompleted ? "隐藏已完成" : `已完成 ${completedItems.length}`}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="app-workspace-todos-panel__body">
        {todos.loading ? (
          <div className="app-workspace-todos-panel__loading">
            <Spin size="small" />
          </div>
        ) : !todos.hasScope ? (
          <div className="app-workspace-todos-panel__list-empty">
            <Typography.Text type="secondary">请先在左侧选择工作区或仓库</Typography.Text>
          </div>
        ) : (
          <>
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
                placeholder="新建提醒"
                value={draftTitle}
                disabled={!todos.hasScope}
                onChange={(e) => setDraftTitle(e.target.value)}
                onPressEnter={addTodo}
              />
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label="添加提醒"
                disabled={!todos.hasScope}
                onClick={addTodo}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
