import { Empty, Progress, Tag, Typography } from "antd";
import { DeploymentUnitOutlined, RobotOutlined, FileTextOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "../copy";
import type { TaskEvidenceVM } from "../presenter/types";
import {
  listMissionEvidence,
  type MissionEvidence,
} from "../../../services/missionControlBackend";
import { AnchorSection } from "./AnchorSection";
import { EngineeringFoldout } from "./EngineeringFoldout";
import { TaskEditorInline } from "./TaskEditorInline";

interface EvidencePaneProps {
  evidence: TaskEvidenceVM | null;
  missionId?: string | null;
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
  missionId,
  onPatchTitle,
  onPatchDescription,
  onPatchRole,
  onPatchTaskList,
  onDeleteTask,
  onRestoreTask,
  onAddTask,
  onOpenPrdAnchor,
}: EvidencePaneProps) {
  const [realEvidence, setRealEvidence] = useState<MissionEvidence[]>([]);

  // Fetch real evidence from backend when task is selected
  useEffect(() => {
    if (!missionId || !evidence?.taskId) {
      setRealEvidence([]);
      return;
    }
    let cancelled = false;
    listMissionEvidence({ missionId, taskId: evidence.taskId })
      .then((list) => { if (!cancelled) setRealEvidence(list); })
      .catch(() => { if (!cancelled) setRealEvidence([]); });
    return () => { cancelled = true; };
  }, [missionId, evidence?.taskId]);

  const dispatchRows = buildDispatchRows(evidence, realEvidence);
  const progressPercent = evidence ? progressForStatus(evidence.status, realEvidence) : 0;

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
          <div className="mission-evidence">
            {/* Task header */}
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

              {/* Agent rows — from real evidence + fallback */}
              {dispatchRows.length > 0 ? (
                <div className="mission-agent-list">
                  {dispatchRows.map((row) => (
                    <div key={row.key} className="mission-agent-row">
                      <RobotOutlined />
                      <span className="mission-agent-row__name">{row.name}</span>
                      <span className="mission-agent-row__target">{row.target}</span>
                      <span className={`mission-agent-row__state mission-agent-row__state--${row.stateKind}`}>
                        {row.state}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {realEvidence.length === 0 ? (
                <Progress percent={progressPercent} showInfo={false} size="small" />
              ) : null}
            </section>

            {/* Real evidence entries */}
            {realEvidence.length > 0 ? (
              <div className="mission-evidence-section">
                <Typography.Text className="mission-evidence-section__title">
                  <FileTextOutlined /> 执行证据 ({realEvidence.length})
                </Typography.Text>
                {realEvidence.map((ev) => (
                  <div key={ev.evidenceId} className="mission-evidence-entry">
                    <div className="mission-evidence-entry__head">
                      <Tag color="blue" style={{ fontSize: 10 }}>{ev.evidenceType ?? "general"}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                        {new Date(ev.createdAt).toLocaleTimeString("zh-CN")}
                      </Typography.Text>
                    </div>
                    {ev.summary ? (
                      <Typography.Text style={{ fontSize: 12 }}>{ev.summary}</Typography.Text>
                    ) : null}
                    {ev.repositoryPath ? (
                      <Typography.Text code style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                        {ev.repositoryPath}
                      </Typography.Text>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mission-evidence-summary">
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {evidence.role ? <Tag>{ROLE_LABEL[evidence.role]}</Tag> : null}
                {evidence.isEdited ? <Tag color="warning">已编辑</Tag> : null}
                {evidence.isManual ? <Tag color="blue">手工新增</Tag> : null}
              </span>
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
          </div>
        )}
      </div>
    </section>
  );
}

interface DispatchRow {
  key: string;
  name: string;
  target: string;
  state: string;
  stateKind: "done" | "running" | "queued" | "blocked";
}

function buildDispatchRows(evidence: TaskEvidenceVM | null, realEvidence: MissionEvidence[]): DispatchRow[] {
  if (!evidence) return [];

  // Prefer real evidence from backend
  if (realEvidence.length > 0) {
    return realEvidence.map((ev, i) => ({
      key: ev.evidenceId ?? `ev-${i}`,
      name: ev.evidenceType ?? "agent",
      target: (ev.repositoryPath ?? "").split("/").pop() || ev.summary?.slice(0, 40) || evidence.taskId,
      state: "完成",
      stateKind: "done" as const,
    }));
  }

  // Fallback to status-derived rows (no backend evidence yet)
  const taskLabel = evidence.taskId;
  if (evidence.status === "blocked") {
    return [
      { key: "research", name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { key: "impl", name: "trellis-implement", target: taskLabel, state: "阻塞", stateKind: "blocked" },
      { key: "check", name: "trellis-check", target: taskLabel, state: "等待队列", stateKind: "queued" },
    ];
  }
  if (evidence.status === "running" || evidence.status === "preparing") {
    return [
      { key: "research", name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { key: "impl", name: "trellis-implement", target: taskLabel, state: "进行", stateKind: "running" },
      { key: "check", name: "trellis-check", target: taskLabel, state: "等待队列", stateKind: "queued" },
    ];
  }
  if (evidence.status === "completed") {
    return [
      { key: "research", name: "trellis-research", target: taskLabel, state: "完成", stateKind: "done" },
      { key: "impl", name: "trellis-implement", target: taskLabel, state: "完成", stateKind: "done" },
      { key: "check", name: "trellis-check", target: taskLabel, state: "完成", stateKind: "done" },
    ];
  }
  return [];
}

function progressForStatus(status: TaskEvidenceVM["status"], realEvidence: MissionEvidence[]): number {
  if (realEvidence.length > 0) return 100;
  if (status === "completed") return 100;
  if (status === "running") return 62;
  if (status === "preparing") return 34;
  if (status === "blocked") return 48;
  return 8;
}
