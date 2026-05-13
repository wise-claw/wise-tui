import type { ProjectItem } from "../../types";
import "./index.css";

export interface TaskCardsNavProps {
  /** 当前选中的项目，用于确定需求/任务面板的数据源 */
  activeProject: ProjectItem | null;
  /** 需求卡片是否处于激活态（面板已展开） */
  requirementPanelActive?: boolean;
  /** 任务卡片是否处于激活态（面板已展开） */
  taskPanelActive?: boolean;
  /** 无选中项目时的提示回调 */
  onRequireProjectSelect?: () => void;
  onOpenRequirementPanel?: () => void;
  onOpenTaskPanel?: () => void;
}

export function TaskCardsNav({
  activeProject,
  requirementPanelActive = false,
  taskPanelActive = false,
  onRequireProjectSelect,
  onOpenRequirementPanel,
  onOpenTaskPanel,
}: TaskCardsNavProps) {
  function handleRequirementClick() {
    if (!activeProject) {
      onRequireProjectSelect?.();
      return;
    }
    onOpenRequirementPanel?.();
  }

  return (
    <div className="app-left-sidebar-task-cards-nav">
      <button
        type="button"
        className={`app-left-sidebar-task-card app-left-sidebar-task-card--requirement${requirementPanelActive ? " app-left-sidebar-task-card--active" : ""}`}
        onClick={handleRequirementClick}
        title="需求：项目需求拆分与管理"
      >
        <span className="app-left-sidebar-task-card-icon" aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.25 2.25h6.3l2.2 2.2V13H4.25V2.25z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M10.55 2.25v2.2h2.2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M5.35 7.35h5.3M5.35 9.35h5.3M5.35 11.35h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="app-left-sidebar-task-card-label">需求</span>
      </button>
      <button
        type="button"
        className={`app-left-sidebar-task-card app-left-sidebar-task-card--task${taskPanelActive ? " app-left-sidebar-task-card--active" : ""}`}
        onClick={onOpenTaskPanel}
        title="任务：项目任务列表"
      >
        <span className="app-left-sidebar-task-card-icon" aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
        <span className="app-left-sidebar-task-card-label">任务</span>
      </button>
    </div>
  );
}
