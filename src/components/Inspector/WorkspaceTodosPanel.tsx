import { Button } from "antd";
import { memo, useMemo, useState } from "react";
import { useWorkspaceTodos } from "../../hooks/useWorkspaceTodos";
import { InspectorCollapsibleSection } from "./InspectorCollapsibleSection";
import { WorkspaceTodosEditor } from "./WorkspaceTodosEditor";
import "./WorkspaceTodosPanel.css";

export interface WorkspaceTodosPanelProps {}

export const WorkspaceTodosPanel = memo(function WorkspaceTodosPanel() {
  const todos = useWorkspaceTodos();
  const [showCompleted, setShowCompleted] = useState(false);

  const completedCount = useMemo(
    () => todos.items.filter((item) => item.completed).length,
    [todos.items],
  );

  return (
    <InspectorCollapsibleSection
      sectionId="todos"
      className="app-workspace-todos-panel"
      ariaLabel="待办事项"
      title="待办事项"
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
          todos={todos}
          showCompleted={showCompleted}
          onShowCompletedChange={setShowCompleted}
          showCompletedToggle={false}
        />
      </div>
    </InspectorCollapsibleSection>
  );
});
