import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Typography } from "antd";
import {
  FileTextOutlined,
  ApartmentOutlined,
  CodeOutlined,
  BranchesOutlined,
  RobotOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import {
  getRequirementTrace,
  type MissionRequirementTrace,
} from "../../../services/missionControlBackend";
import {
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
  type OpenRepositoryFileDetail,
} from "../../../constants/workflowUiEvents";

interface RequirementTracePanelProps {
  missionId: string | null;
  requirementId: string | null;
}

export function RequirementTracePanel({ missionId, requirementId }: RequirementTracePanelProps) {
  const [trace, setTrace] = useState<MissionRequirementTrace | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!missionId || !requirementId) {
      setTrace(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRequirementTrace({ missionId, requirementId })
      .then((t) => { if (!cancelled) setTrace(t); })
      .catch(() => { if (!cancelled) setTrace(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [missionId, requirementId]);

  if (!missionId || !requirementId) return null;

  const openCodeFile = (filePath: string, line?: number | null) => {
    if (!filePath.trim()) return;
    const detail: OpenRepositoryFileDetail = {
      relativePath: filePath,
      line: line ?? null,
    };
    window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, { detail }));
  };

  return (
    <section className="req-trace-panel">
      <div className="req-trace-panel__header">
        <BranchesOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>
          需求追溯：{requirementId}
        </Typography.Text>
      </div>

      {loading ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>
      ) : !trace ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无法加载需求追溯数据" />
      ) : (
        <div className="req-trace-panel__body">
          {/* Requirement source text */}
          {trace.requirement ? (
            <div className="req-trace-step">
              <div className="req-trace-step__head">
                <FileTextOutlined />
                <span>需求原文</span>
              </div>
              <Typography.Paragraph
                className="req-trace-step__text"
                ellipsis={{ rows: 4, expandable: true }}
              >
                {trace.requirement.content}
              </Typography.Paragraph>
            </div>
          ) : null}

          <div className="req-trace-arrow"><ArrowRightOutlined /></div>

          {/* Clusters */}
          {trace.clusters.length > 0 ? (
            <div className="req-trace-step">
              <div className="req-trace-step__head">
                <ApartmentOutlined />
                <span>所属集群</span>
                <Tag style={{ fontSize: 10 }}>{trace.clusters.length}</Tag>
              </div>
              {trace.clusters.map((c) => (
                <div key={c.id} className="req-trace-node">
                  <Typography.Text strong style={{ fontSize: 12 }}>{c.title}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                    repo: {c.repositoryIds.join(", ")}
                  </Typography.Text>
                </div>
              ))}
            </div>
          ) : null}

          <div className="req-trace-arrow"><ArrowRightOutlined /></div>

          {/* Tasks */}
          <div className="req-trace-step">
            <div className="req-trace-step__head">
              <CodeOutlined />
              <span>关联任务</span>
              <Tag style={{ fontSize: 10 }}>{trace.tasks.length}</Tag>
            </div>
            {trace.tasks.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>暂无关联任务</Typography.Text>
            ) : (
              trace.tasks.map((task) => (
                <div key={task.taskId} className="req-trace-task">
                  <div className="req-trace-task__head">
                    <span className="req-trace-task__id">{task.taskId}</span>
                    <Tag color={task.status === "done" ? "success" : task.status === "in_progress" ? "processing" : "default"} style={{ fontSize: 9 }}>
                      {task.status ?? "unknown"}
                    </Tag>
                    {task.role ? <Tag style={{ fontSize: 9 }}>{task.role}</Tag> : null}
                  </div>
                  <Typography.Text style={{ fontSize: 12 }}>{task.title}</Typography.Text>

                  {/* Code anchors */}
                  {task.codeAnchors.length > 0 ? (
                    <div className="req-trace-task__anchors">
                      {task.codeAnchors.map((a, i) => (
                        <button
                          key={i}
                          type="button"
                          className="req-trace-anchor-btn"
                          onClick={() => openCodeFile(a.filePath, a.line)}
                        >
                          {a.filePath}{a.line != null ? `:${a.line}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* Agent assignments */}
                  {task.assignments.length > 0 ? (
                    <div className="req-trace-task__agents">
                      <RobotOutlined style={{ fontSize: 10, color: "var(--mission-dim)" }} />
                      {task.assignments.map((a) => (
                        <Tag key={a.assignmentId} color="blue" style={{ fontSize: 9 }}>
                          {a.agentType} · {a.stage}
                        </Tag>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
