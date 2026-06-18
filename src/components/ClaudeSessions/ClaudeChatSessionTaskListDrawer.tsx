import { Drawer, Typography } from "antd";
import { memo } from "react";
import { UnorderedListOutlined } from "@ant-design/icons";
import type { ProjectItem } from "../../types";
import { requestOpenAssistant } from "../../constants/workflowUiEvents";
import "./TaskListDrawerEmptyState.css";

export interface ClaudeChatSessionTaskListDrawerProps {
  open: boolean;
  onClose: () => void;
  traceDrawerWidth: number;
  activeProject?: ProjectItem | null;
}

export const ClaudeChatSessionTaskListDrawer = memo(function ClaudeChatSessionTaskListDrawer({
  open,
  onClose,
  traceDrawerWidth,
  activeProject,
}: ClaudeChatSessionTaskListDrawerProps) {
  const activeProjectName = activeProject?.name?.trim() || null;

  return (
    <Drawer
      title="任务"
      placement="right"
      size={traceDrawerWidth}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{ body: "app-claude-task-list-drawer-body" }}
      styles={{
        body: {
          padding: 12,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
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
              <UnorderedListOutlined aria-hidden />
              <span>当前工作区</span>
              <strong>{activeProjectName}</strong>
            </div>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
});

/** 关闭任务 Drawer 后打开助手 Cockpit。 */
export function openRequirementSourceFromTaskDrawer(onClose: () => void): void {
  onClose();
  requestOpenAssistant();
}
