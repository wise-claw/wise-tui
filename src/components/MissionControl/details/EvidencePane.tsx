import { Empty, Progress, Space, Tag, Typography } from "antd";
import { DeploymentUnitOutlined, RobotOutlined } from "@ant-design/icons";
import { ROLE_LABEL } from "../copy";
import type { TaskEvidenceVM } from "../presenter/types";
import { AnchorSection } from "./AnchorSection";
import { EngineeringFoldout } from "./EngineeringFoldout";
import { TaskEditorInline } from "./TaskEditorInline";

interface EvidencePaneProps {
  evidence: TaskEvidenceVM | null;
  onPatchTitle: (clusterId: string, taskId: string, title: string, isManual: boolean) => void;
  onPatchDescription: (clusterId: string, taskId: string, description: string, isManual: boolean) => void;
  onPatchRole: (clusterId: string, taskId: string, role: TaskEvidenceVM["role"], isManual: boolean) => void;
  onPatchTaskList: (clusterId: string, taskId: string, field: "subtasks" | "dod", items: string[], isManual: boolean) => void;
  onDeleteTask: (clusterId: string, taskId: string) => void;
  onRestoreTask: (clusterId: string, taskId: string) => void;
  onAddTask: (clusterId: string, sourceRequirementIds: string[]) => string | null;
  onOpenPrdAnchor: () => void;
}

export function EvidencePane({
  evidence,
  onPatchTitle,
  onPatchDescription,
  onPatchRole,
  onPatchTaskList,
  onDeleteTask,
  onRestoreTask,
  onAddTask,
  onOpenPrdAnchor,
}: EvidencePaneProps) {
  const dispatchRows = evidence ? buildDispatchRows(evidence) : [];
  const progressPercent = evidence ? progressForStatus(evidence.status) : 0;
  return (
    <section className="mission-column mission-column--evidence">
      <div className="mission-column__header">
        <span className="mission-column__title">
          <DeploymentUnitOutlined />
          派发 / 子代理
        </span>
        {evidence?.repositoryLabel ? <span className="mission-column__hint">{evidence.repositoryLabel}</span> : null}
      </div>
      <div className="mission-column__scroll">
        {!evidence ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个任务查看详情" />
        ) : (
          <Space orientation="vertical" size={14} className="mission-evidence">
            <section className="mission-dispatch-card">
              <div className="mission-dispatch-card__top">
                <div>
                  <span className="mission-dispatch-card__repo">{evidence.repositoryLabel ?? "待选择仓位"}</span>
                  <Typography.Title level={4} className="mission-evidence__title">
                    {evidence.title}
                  </Typography.Title>
                </div>
                <span className={`mission-status mission-status--${evidence.status}`}>
                  <i />
                  {evidence.statusLabel}
                </span>
              </div>
              <div className="mission-agent-list">
                {dispatchRows.map((row) => (
                  <div key={row.name} className="mission-agent-row">
                    <RobotOutlined />
                    <span className="mission-agent-row__name">{row.name}</span>
                    <span className="mission-agent-row__target">{row.target}</span>
                    <span className={`mission-agent-row__state mission-agent-row__state--${row.stateKind}`}>
                      {row.state}
                    </span>
                  </div>
                ))}
              </div>
              <Progress percent={progressPercent} showInfo={false} size="small" />
            </section>
            <div className="mission-evidence-summary">
              <Space size={6} wrap>
                {evidence.role ? <Tag>{ROLE_LABEL[evidence.role]}</Tag> : null}
                {evidence.isEdited ? <Tag color="warning">已编辑</Tag> : null}
                {evidence.isManual ? <Tag color="blue">手工新增</Tag> : null}
              </Space>
              {evidence.description ? (
                <Typography.Paragraph className="mission-evidence__description">
                  {evidence.description}
                </Typography.Paragraph>
              ) : null}
            </div>
            <section className="mission-evidence-section">
              <Typography.Text className="mission-evidence-section__title">需求来源</Typography.Text>
              {evidence.sourceRequirements.map((requirement) => (
                <div key={requirement.id} className="mission-source-requirement">
                  <Typography.Text strong>{requirement.id}</Typography.Text>
                  <Typography.Text>{requirement.bodyPreview}</Typography.Text>
                </div>
              ))}
            </section>
            <AnchorSection evidence={evidence} onOpenPrdAnchor={onOpenPrdAnchor} />
            <TaskEditorInline
              evidence={evidence}
              onPatchTitle={onPatchTitle}
              onPatchDescription={onPatchDescription}
              onPatchRole={onPatchRole}
              onPatchTaskList={onPatchTaskList}
              onDeleteTask={onDeleteTask}
              onRestoreTask={onRestoreTask}
              onAddTask={onAddTask}
            />
            <EngineeringFoldout evidence={evidence} />
          </Space>
        )}
      </div>
    </section>
  );
}

interface DispatchRow {
  name: string;
  target: string;
  state: string;
  stateKind: "done" | "running" | "queued" | "blocked";
}

function buildDispatchRows(evidence: TaskEvidenceVM): DispatchRow[] {
  const taskLabel = evidence.taskId;
  if (evidence.status === "blocked") {
    return [
      { name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { name: "trellis-implement", target: taskLabel, state: "阻塞", stateKind: "blocked" },
      { name: "trellis-check", target: taskLabel, state: "等待队列", stateKind: "queued" },
    ];
  }
  if (evidence.status === "running" || evidence.status === "preparing") {
    return [
      { name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { name: "trellis-implement", target: taskLabel, state: "进行", stateKind: "running" },
      { name: "trellis-check", target: taskLabel, state: "等待队列", stateKind: "queued" },
    ];
  }
  if (evidence.status === "completed") {
    return [
      { name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { name: "trellis-implement", target: taskLabel, state: "完成", stateKind: "done" },
      { name: "trellis-check", target: taskLabel, state: "完成", stateKind: "done" },
    ];
  }
  return [
    { name: "trellis-research", target: taskLabel, state: "等待队列", stateKind: "queued" },
    { name: "trellis-implement", target: taskLabel, state: "等待队列", stateKind: "queued" },
    { name: "trellis-check", target: taskLabel, state: "等待队列", stateKind: "queued" },
  ];
}

function progressForStatus(status: TaskEvidenceVM["status"]): number {
  if (status === "completed") return 100;
  if (status === "running") return 62;
  if (status === "preparing") return 34;
  if (status === "blocked") return 48;
  return 8;
}
