import { Drawer, Space, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { ProjectItem } from "../types";
import { useTrellisRuntime } from "../hooks/useTrellisRuntime";
import { AgentOwnershipGraph } from "./MissionControl/canvas/AgentOwnershipGraph";
import { RuntimeEventFeed } from "./MissionControl/canvas/RuntimeEventFeed";
import { SpecRevisionTimeline } from "./MissionControl/canvas/SpecRevisionTimeline";
import { OnboardingChecklist } from "./MissionControl/canvas/OnboardingChecklist";
import { WorkspaceSnapshotViewer } from "./MissionControl/canvas/WorkspaceSnapshotViewer";
import { WorkflowGraphPanel } from "./MissionControl/engineering/WorkflowGraphPanel";
import { SpecLibraryPanel } from "./MissionControl/engineering/SpecLibraryPanel";

interface ProjectTrellisCenterProps {
  open: boolean;
  project: ProjectItem | null;
  onClose: () => void;
  onOpenProjectSession?: (project: ProjectItem) => void | Promise<void>;
  onRequestSpecAgentUpdate?: (project: ProjectItem, area: string) => void | Promise<void>;
}

export function ProjectTrellisCenter({
  open,
  project,
  onClose,
  onOpenProjectSession,
  onRequestSpecAgentUpdate,
}: ProjectTrellisCenterProps) {
  const rootPath = project?.rootPath ?? null;
  const { agentGraph } = useTrellisRuntime({
    projectId: project?.id ?? null,
    rootPath,
    enabled: open && Boolean(project && rootPath),
  });

  const title = useMemo(
    () => (project ? `项目 Trellis · ${project.name}` : "项目 Trellis"),
    [project],
  );

  return (
    <Drawer open={open} onClose={onClose} width={940} title={title}>
      <div className="project-trellis-center__summary">
        <div className="project-trellis-center__summary-main">
          <Typography.Text strong>Trellis / SDD 项目治理</Typography.Text>
          <Typography.Text type="secondary">
            这里管理项目规范、工作流、运行事件和快照；需求拆分只负责从 PRD 推进到任务和证据。
          </Typography.Text>
        </div>
        <Space size={6} wrap>
          <Tag color={rootPath ? "success" : "warning"}>{rootPath ? "rootPath ready" : "no rootPath"}</Tag>
          <Tag>{project?.sddMode ?? "wise_trellis"}</Tag>
        </Space>
        {rootPath ? (
          <Typography.Text className="project-trellis-center__root" title={rootPath}>
            {rootPath}
          </Typography.Text>
        ) : null}
      </div>

      <Tabs
        items={[
          {
            key: "spec",
            label: "Spec Library",
            children: (
              <SpecLibraryPanel
                rootPath={rootPath}
                enabled={open}
                onOpenProjectSession={
                  project && onOpenProjectSession ? () => onOpenProjectSession(project) : undefined
                }
                onRequestAgentUpdate={
                  project && onRequestSpecAgentUpdate
                    ? (area) => onRequestSpecAgentUpdate(project, area)
                    : undefined
                }
              />
            ),
          },
          {
            key: "workflow",
            label: "Workflow",
            children: (
              <WorkflowGraphPanel
                projectId={project?.id ?? null}
                rootPath={rootPath}
                enabled={open}
              />
            ),
          },
          {
            key: "runtime",
            label: "Runtime",
            children: (
              <div className="project-trellis-center__runtime">
                <OnboardingChecklist rootPath={rootPath} />
                <AgentOwnershipGraph graph={agentGraph} />
                <RuntimeEventFeed rootPath={rootPath} projectId={project?.id ?? null} />
                <SpecRevisionTimeline rootPath={rootPath} />
                <WorkspaceSnapshotViewer rootPath={rootPath} />
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
