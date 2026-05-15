import { useMemo, useState } from "react";
import { Alert, Space, Tag, Typography } from "antd";
import {
  ApiOutlined,
  BranchesOutlined,
  CodeOutlined,
  FileTextOutlined,
  LinkOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import type { WorkflowGraph } from "../../types";
import {
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
} from "../../constants/workflowUiEvents";
import {
  buildPrdSplitWorkflowTracePreview,
  type PrdSplitWorkflowTraceTask,
  type PrdSplitWorkflowTraceRequirement,
} from "../../services/prdSplit/workflowGraphFromSplit";

interface Props {
  graph: WorkflowGraph;
}

type SelectedTaskState = {
  requirementId: string | null;
  taskId: string | null;
};

export function PrdTraceMap({ graph }: Props) {
  const preview = useMemo(() => buildPrdSplitWorkflowTracePreview(graph), [graph]);
  const tasksById = useMemo(
    () => new Map(preview.tasks.map((task) => [task.sourceTaskId, task])),
    [preview.tasks],
  );
  const [selected, setSelected] = useState<SelectedTaskState>({
    requirementId: preview.requirements[0]?.id ?? null,
    taskId: preview.requirements[0]?.taskIds[0] ?? preview.tasks[0]?.sourceTaskId ?? null,
  });

  const selectedRequirement = preview.requirements.find((item) => item.id === selected.requirementId) ?? null;
  const selectedTask = selected.taskId ? tasksById.get(selected.taskId) ?? null : null;
  const selectedTaskIds = selectedRequirement?.taskIds ?? [];

  const onSelectRequirement = (requirementId: string) => {
    const requirement = preview.requirements.find((item) => item.id === requirementId) ?? null;
    setSelected({
      requirementId,
      taskId: requirement?.taskIds[0] ?? null,
    });
  };

  const onSelectTask = (taskId: string) => {
    const task = tasksById.get(taskId);
    if (!task) return;
    setSelected((current) => ({
      requirementId:
        current.requirementId && preview.requirements.some((item) => item.id === current.requirementId)
          ? current.requirementId
          : task.sourceRequirementIds[0] ?? null,
      taskId,
    }));
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            需求 · 任务 · 代码溯源
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            点需求看拆分，点任务看并行层，点锚点直达仓库文件。
          </Typography.Text>
        </div>
        <Tag color="processing">{preview.requirements.length} 条需求 · {preview.tasks.length} 个任务</Tag>
      </div>

      <div style={gridStyle}>
        <TraceColumn
          title="PRD 需求"
          icon={<FileTextOutlined />}
          aside={`${selectedRequirement?.taskIds.length ?? 0} 个子任务`}
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {preview.requirements.slice(0, 8).map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                active={requirement.id === selected.requirementId}
                onClick={() => onSelectRequirement(requirement.id)}
              />
            ))}
          </Space>
        </TraceColumn>

        <TraceColumn
          title="并行层 / 依赖"
          icon={<NodeIndexOutlined />}
          aside={`${preview.parallelGroups.length} 组`}
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {preview.parallelGroups.map((group, index) => (
              <div key={group.id} style={parallelGroupStyle(group.taskIds.length > 1, group.taskIds.some((id) => selectedTaskIds.includes(id)))}>
                <Space size={6} align="center" wrap style={{ marginBottom: 8 }}>
                  <Tag color={group.taskIds.length > 1 ? "blue" : "default"}>
                    {group.taskIds.length > 1 ? "可并行" : "单任务"}
                  </Tag>
                  <Typography.Text strong>第 {index + 1} 层</Typography.Text>
                  {group.taskIds.length > 1 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      虚线框内的任务可同时跑
                    </Typography.Text>
                  ) : null}
                </Space>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {group.taskIds.map((taskId) => {
                    const task = tasksById.get(taskId);
                    return task ? (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={task.sourceTaskId === selected.taskId}
                        onClick={() => onSelectTask(task.id)}
                      />
                    ) : null;
                  })}
                </Space>
              </div>
            ))}
          </Space>
        </TraceColumn>

        <TraceColumn
          title="代码锚点"
          icon={<CodeOutlined />}
          aside={selectedTask?.codeAnchors.length ? `${selectedTask.codeAnchors.length} 个` : "无"}
        >
          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              selectedRequirement={selectedRequirement}
              onOpenAnchor={(anchorIndex) => {
                const anchor = selectedTask.codeAnchors[anchorIndex];
                if (!anchor) return;
                window.dispatchEvent(
                  new CustomEvent(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, {
                    detail: {
                      repositoryId: selectedTask.repositoryId ?? undefined,
                      relativePath: anchor.filePath,
                      line: anchor.line ?? null,
                    },
                  }),
                );
              }}
            />
          ) : (
            <Alert type="info" showIcon message="选择一个任务查看代码锚点" />
          )}
        </TraceColumn>
      </div>
    </div>
  );
}

function RequirementCard({
  requirement,
  active,
  onClick,
}: {
  requirement: PrdSplitWorkflowTraceRequirement;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" style={requirementCardStyle(active)} onClick={onClick}>
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
        <Space size={6} wrap>
          <Tag color={active ? "processing" : "default"}>{requirement.id}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {requirement.completedTasks}/{requirement.totalTasks} 已完成
          </Typography.Text>
        </Space>
        <Typography.Text strong style={{ display: "block" }}>
          {truncate(requirement.content || "未写入需求正文", 44)}
        </Typography.Text>
      </Space>
    </button>
  );
}

function TaskCard({
  task,
  selected,
  onClick,
}: {
  task: PrdSplitWorkflowTraceTask;
  selected: boolean;
  onClick: () => void;
}) {
  const repositoryHint = task.repositoryIds.length > 0 ? `仓库 ${task.repositoryIds.join(", ")}` : "未指派仓库";
  return (
    <button type="button" style={taskCardStyle(selected)} onClick={onClick}>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Space size={6} wrap align="center">
          <Tag color={selected ? "processing" : "default"}>{task.sourceTaskId}</Tag>
          <Typography.Text strong>{task.title}</Typography.Text>
          <Tag color={task.role === "frontend" ? "blue" : task.role === "backend" ? "geekblue" : "default"}>
            {task.role || "task"}
          </Tag>
          {task.parallelGroupId ? (
            <Tag color="purple">
              <BranchesOutlined /> {task.parallelGroupId}
            </Tag>
          ) : null}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {repositoryHint} · {task.dependencies.length > 0 ? `依赖 ${task.dependencies.join(", ")}` : "无前置依赖"}
        </Typography.Text>
      </Space>
    </button>
  );
}

function TaskDetail({
  task,
  selectedRequirement,
  onOpenAnchor,
}: {
  task: PrdSplitWorkflowTraceTask;
  selectedRequirement: PrdSplitWorkflowTraceRequirement | null;
  onOpenAnchor: (anchorIndex: number) => void;
}) {
  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <div style={detailCardStyle}>
        <Space size={6} wrap align="center">
          <Tag color="processing">{task.sourceTaskId}</Tag>
          <Typography.Text strong>{task.title}</Typography.Text>
          <Tag>{task.taskName ?? "未落盘任务"}</Tag>
        </Space>
        <Typography.Paragraph style={{ margin: "8px 0 0" }}>
          {selectedRequirement ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              对应需求 {selectedRequirement.id}，当前已拆 {selectedRequirement.totalTasks} 个任务。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              这个任务没有匹配到当前选中的需求。
            </Typography.Text>
          )}
        </Typography.Paragraph>
      </div>

      <div style={anchorListStyle}>
        <Space size={6} align="center" style={{ marginBottom: 8 }}>
          <ApiOutlined />
          <Typography.Text strong>代码锚点</Typography.Text>
        </Space>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {task.codeAnchors.length > 0 ? (
            task.codeAnchors.map((anchor, index) => (
              <button
                key={anchor.raw}
                type="button"
                style={anchorCardStyle}
                onClick={() => onOpenAnchor(index)}
              >
                <Space direction="vertical" size={2} style={{ width: "100%" }}>
                  <Space size={6} wrap>
                    <Tag color="blue">#{index + 1}</Tag>
                    <Typography.Text code style={{ whiteSpace: "normal" }}>
                      {anchor.filePath}{anchor.line ? `:${anchor.line}` : ""}
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {anchor.raw}
                  </Typography.Text>
                </Space>
              </button>
            ))
          ) : (
            <Alert type="warning" showIcon message="当前任务没有代码锚点" />
          )}
        </Space>
      </div>

      <div style={anchorListStyle}>
        <Space size={6} align="center" style={{ marginBottom: 8 }}>
          <LinkOutlined />
          <Typography.Text strong>PRD 锚点</Typography.Text>
        </Space>
        {task.prdAnchor ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {task.prdAnchor.from} - {task.prdAnchor.to}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未记录 PRD 区间
          </Typography.Text>
        )}
      </div>
    </Space>
  );
}

function TraceColumn({
  title,
  icon,
  aside,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Typography.Text strong>
          {icon} {title}
        </Typography.Text>
        {aside ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aside}</Typography.Text> : null}
      </div>
      {children}
    </section>
  );
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 1))}…` : trimmed;
}

const containerStyle: React.CSSProperties = {
  width: "min(1000px, 100%)",
  margin: "16px auto 0",
  padding: 16,
  border: "1px solid var(--ant-color-border)",
  borderRadius: 8,
  background: "var(--ant-color-bg-container)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 16,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 0.95fr) minmax(320px, 1.4fr) minmax(260px, 1fr)",
  gap: 16,
  textAlign: "left",
};

function requirementCardStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${active ? "var(--ant-color-primary-border)" : "var(--ant-color-border)"}`,
    background: active ? "var(--ant-color-primary-bg)" : "var(--ant-color-fill-quaternary)",
    cursor: "pointer",
    textAlign: "left",
  };
}

function parallelGroupStyle(isParallel: boolean, active: boolean): React.CSSProperties {
  return {
    padding: 10,
    borderRadius: 8,
    border: isParallel ? "1px dashed var(--ant-color-border)" : "1px solid transparent",
    background: active ? "var(--ant-color-primary-bg)" : "var(--ant-color-fill-quaternary)",
  };
}

function taskCardStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${active ? "var(--ant-color-primary-border)" : "var(--ant-color-border)"}`,
    background: active ? "var(--ant-color-bg-container)" : "var(--ant-color-bg-container)",
    cursor: "pointer",
    textAlign: "left",
  };
}

const detailCardStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--ant-color-border)",
  background: "var(--ant-color-fill-quaternary)",
};

const anchorListStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--ant-color-border)",
  background: "var(--ant-color-bg-container)",
};

const anchorCardStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--ant-color-border)",
  background: "var(--ant-color-fill-quaternary)",
  cursor: "pointer",
  textAlign: "left",
};
