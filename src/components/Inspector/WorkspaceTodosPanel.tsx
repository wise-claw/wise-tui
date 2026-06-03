import { Button } from "antd";
import { useMemo, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import { InspectorCollapsibleSection } from "./InspectorCollapsibleSection";
import { WorkspaceTodosEditor } from "./WorkspaceTodosEditor";
import "./WorkspaceTodosPanel.css";

export interface WorkspaceTodosPanelProps {
  projectId: string | null;
  repositoryId: number | null;
}

export function WorkspaceTodosPanel({ projectId, repositoryId }: WorkspaceTodosPanelProps) {
  const todos = useWorkspaceTodos({ projectId, repositoryId });
  const [showCompleted, setShowCompleted] = useState(false);

  const incompleteCount = useMemo(
    () => todos.displayItems.filter((item) => !item.completed).length,
    [todos.displayItems],
  );

  const completedCount = useMemo(
    () => todos.displayItems.filter((item) => item.completed).length,
    [todos.displayItems],
  );

  return (
    <InspectorCollapsibleSection
      sectionId="todos"
      className="app-workspace-todos-panel"
      ariaLabel="待办事项"
      title="待办事项"
      summaryMeta={incompleteCount > 0 ? String(incompleteCount) : null}
      headActions={
        completedCount > 0 ? (
          <div className="app-workspace-todos-panel__head-actions">
            <Button
              type="link"
              size="small"
              className="app-workspace-todos-panel__toggle-done"
              onClick={() => setShowCompleted((value) => !value)}
            >
              {showCompleted ? "隐藏已完成" : `已完成 ${completedCount}`}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="app-workspace-todos-panel__body">
        <WorkspaceTodosEditor
          projectId={projectId}
          repositoryId={repositoryId}
          todos={todos}
          showCompleted={showCompleted}
          onShowCompletedChange={setShowCompleted}
          showCompletedToggle={false}
        />
      </div>
    </InspectorCollapsibleSection>
  );
}
