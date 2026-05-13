import { CloseOutlined } from "@ant-design/icons";
import { Button, Empty, Tooltip, Typography } from "antd";
import type { ProjectItem } from "../../types";
import "./index.css";

interface Props {
  activeProject: ProjectItem | null;
  onClose: () => void;
}

export function TaskPanel({ activeProject, onClose }: Props) {
  return (
    <div className="app-task-panel-overlay" role="dialog" aria-label="任务列表">
      <header className="app-task-panel-header">
        <div className="app-task-panel-header-left">
          <span className="app-task-panel-title">任务</span>
          {activeProject ? (
            <Typography.Text type="secondary" className="app-task-panel-project-label">
              {activeProject.name}
            </Typography.Text>
          ) : null}
        </div>
        <Tooltip title="关闭" mouseEnterDelay={0.35}>
          <Button
            type="text"
            size="small"
            className="app-task-panel-close-btn"
            icon={<CloseOutlined />}
            aria-label="关闭"
            onClick={onClose}
          />
        </Tooltip>
      </header>
      <div className="app-task-panel-body">
        <Empty description="任务列表面板开发中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    </div>
  );
}
