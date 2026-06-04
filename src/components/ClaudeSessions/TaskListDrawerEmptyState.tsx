import {
  FileTextOutlined,
  FolderOpenOutlined,
  RightOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Spin, Typography } from "antd";
import { requestOpenTaskSplitPanel } from "../../constants/workflowUiEvents";
import "./TaskListDrawerEmptyState.css";

type TaskListDrawerEmptyStateProps = {
  loading: boolean;
  activeProjectName?: string | null;
  onOpenRequirementSource: () => void;
};

function TaskListEmptyIcon() {
  return (
    <svg
      className="app-task-list-empty-state__illus"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="14" y="18" width="52" height="44" rx="8" stroke="currentColor" strokeWidth="2" />
      <path d="M24 30h32M24 38h22M24 46h28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="56" cy="52" r="14" fill="var(--ant-color-primary-bg)" stroke="var(--ant-color-primary)" strokeWidth="2" />
      <path
        d="M50 52l4 4 8-8"
        stroke="var(--ant-color-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TaskListDrawerEmptyState({
  loading,
  activeProjectName,
  onOpenRequirementSource,
}: TaskListDrawerEmptyStateProps) {
  if (loading) {
    return (
      <div className="app-task-list-empty-state app-task-list-empty-state--loading">
        <Spin />
        <Typography.Text type="secondary">正在读取 Workspace Trellis 任务…</Typography.Text>
      </div>
    );
  }

  return (
    <div className="app-task-list-empty-state">
      <div className="app-task-list-empty-state__panel">
        <div className="app-task-list-empty-state__hero">
          <div className="app-task-list-empty-state__icon-ring" aria-hidden>
            <TaskListEmptyIcon />
          </div>
          <Typography.Title level={5} className="app-task-list-empty-state__title">
            暂无任务
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="app-task-list-empty-state__lead">
            完成需求拆分或落盘 Trellis 任务后，可在此统一查看与派发。
          </Typography.Paragraph>
        </div>

        <div className="app-task-list-empty-state__sources" role="list">
          <div className="app-task-list-empty-state__source" role="listitem">
            <span className="app-task-list-empty-state__source-icon app-task-list-empty-state__source-icon--prd">
              <FileTextOutlined />
            </span>
            <span className="app-task-list-empty-state__source-body">
              <span className="app-task-list-empty-state__source-title">需求拆分任务</span>
              <span className="app-task-list-empty-state__source-desc">
                在需求助手中编写 PRD、确认拆分后进入列表
              </span>
            </span>
          </div>
          <div className="app-task-list-empty-state__source" role="listitem">
            <span className="app-task-list-empty-state__source-icon app-task-list-empty-state__source-icon--trellis">
              <FolderOpenOutlined />
            </span>
            <span className="app-task-list-empty-state__source-body">
              <span className="app-task-list-empty-state__source-title">Trellis 任务</span>
              <span className="app-task-list-empty-state__source-desc">
                来自 <code>.trellis/tasks/</code> 目录下的开发任务
              </span>
            </span>
          </div>
        </div>

        {activeProjectName ? (
          <div className="app-task-list-empty-state__scope">
            <UnorderedListOutlined aria-hidden />
            <span>当前工作区</span>
            <strong>{activeProjectName}</strong>
          </div>
        ) : null}

        <Button
          type="primary"
          block
          size="middle"
          icon={<FileTextOutlined />}
          className="app-task-list-empty-state__cta"
          onClick={onOpenRequirementSource}
        >
          打开需求来源
          <RightOutlined className="app-task-list-empty-state__cta-arrow" />
        </Button>
        <Typography.Text type="secondary" className="app-task-list-empty-state__footnote">
          进入需求拆分助手，编辑 PRD 与需求索引并生成可执行任务
        </Typography.Text>
      </div>
    </div>
  );
}

/** 关闭任务 Drawer 后打开需求拆分助手（与 App 顶栏/侧栏入口一致）。 */
export function openRequirementSourceFromTaskDrawer(onClose: () => void): void {
  onClose();
  requestOpenTaskSplitPanel();
}
