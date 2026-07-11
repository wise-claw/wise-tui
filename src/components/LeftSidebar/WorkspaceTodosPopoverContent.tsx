import { WorkspaceTodosEditor } from "../Inspector/WorkspaceTodosEditor";
import "./WorkspaceTodosPopoverContent.css";

export interface WorkspaceTodosPopoverContentProps {
  title: string;
  focusAddToken?: number;
}

export function WorkspaceTodosPopoverContent({
  title,
  focusAddToken = 0,
}: WorkspaceTodosPopoverContentProps) {
  return (
    <div
      className="app-workspace-todos-popover"
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <WorkspaceTodosEditor focusAddToken={focusAddToken} />
    </div>
  );
}
