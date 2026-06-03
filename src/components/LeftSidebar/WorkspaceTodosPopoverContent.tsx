import { WorkspaceTodosEditor } from "../Inspector/WorkspaceTodosEditor";
import "./WorkspaceTodosPopoverContent.css";

export interface WorkspaceTodosPopoverContentProps {
  projectId: string | null;
  repositoryId: number | null;
  title: string;
  focusAddToken?: number;
}

export function WorkspaceTodosPopoverContent({
  projectId,
  repositoryId,
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
      <WorkspaceTodosEditor
        projectId={projectId}
        repositoryId={repositoryId}
        showScopeTag={false}
        focusAddToken={focusAddToken}
      />
    </div>
  );
}
