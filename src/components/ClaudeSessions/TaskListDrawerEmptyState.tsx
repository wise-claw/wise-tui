import {
  FileTextOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, Typography } from "antd";
import { requestOpenAssistant } from "../../constants/workflowUiEvents";
import "./TaskListDrawerEmptyState.css";

type TaskListDrawerEmptyStateProps = {
  activeProjectName?: string | null;
  onOpenAssistant: () => void;
};

export function TaskListDrawerEmptyState({
  activeProjectName,
  onOpenAssistant,
}: TaskListDrawerEmptyStateProps) {
  return (
    <div className="app-task-list-empty-state">
      <div className="app-task-list-empty-state__panel">
        <Typography.Title level={5} className="app-task-list-empty-state__title">
          暂无任务
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="app-task-list-empty-state__lead">
          工作流运行产生的可执行任务将在此展示。
        </Typography.Paragraph>
        {activeProjectName ? (
          <div className="app-task-list-empty-state__scope">
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
          onClick={onOpenAssistant}
        >
          打开助手
          <RightOutlined className="app-task-list-empty-state__cta-arrow" />
        </Button>
      </div>
    </div>
  );
}

/** 关闭任务 Drawer 后打开助手 Cockpit。 */
export function openRequirementSourceFromTaskDrawer(onClose: () => void): void {
  onClose();
  requestOpenAssistant();
}
