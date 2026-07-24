import { WorkspaceTodosEditor } from "../Inspector/WorkspaceTodosEditor";
import "./WorkspaceTodosPopoverContent.css";

export interface WorkspaceTodosPopoverContentProps {
  title: string;
  focusAddToken?: number;
  showCompleted?: boolean;
  onShowCompletedChange?: (next: boolean) => void;
}

export function WorkspaceTodosPopoverContent({
  title,
  focusAddToken = 0,
  showCompleted,
  onShowCompletedChange,
}: WorkspaceTodosPopoverContentProps) {
  return (
    <div
      className="app-workspace-todos-popover"
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <WorkspaceTodosEditor
        focusAddToken={focusAddToken}
        showCompleted={showCompleted}
        onShowCompletedChange={onShowCompletedChange}
        showCompletedToggle={false}
      />
    </div>
  );
}
