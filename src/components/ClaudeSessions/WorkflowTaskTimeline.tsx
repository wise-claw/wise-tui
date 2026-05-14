import { Button, Empty, Input, List, Modal, Select, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  EmployeeItem,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../../types";
import {
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
} from "../../constants/workflowEvents";
import { getAcceptanceVerdictSourceStats } from "../../services/workflowTasks";

interface Props {
  tasks: WorkflowTaskItem[];
  eventsByTaskId: Record<string, WorkflowTaskEventItem[]>;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  runtimeSnapshotsByTaskId?: Record<string, WorkflowRuntimeStepSnapshot[]>;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowVerdictMode?: "heuristic" | "structured_only" | "structured_plus_extractor";
  /** 为 false 时不展示顶部「任务时间线」标题（外层 Drawer 已带标题时使用） */
  showTitle?: boolean;
  onDecision: (input: {
    taskId: string;
    employeeId: string;
    decision: "approved" | "rejected";
    reason?: string;
  }) => Promise<void>;
}

export function WorkflowTaskTimeline({
  tasks,
  eventsByTaskId,
  employees,
  workflowTemplates,
  runtimeSnapshotsByTaskId = {},
  taskPendingEmployeesByTaskId,
  workflowVerdictMode = "structured_plus_extractor",
  showTitle = true,
  onDecision,
}: Props) {
  const [employeeId, setEmployeeId] = useState<string | undefined>(employees[0]?.id);
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [submittingReject, setSubmittingReject] = useState(false);
  const [focusedStageIndexByTaskId, setFocusedStageIndexByTaskId] = useState<Record<string, number | null>>({});
  const [expandedEventsByTaskId, setExpandedEventsByTaskId] = useState<Record<string, boolean>>({});
  const activeTasks = useMemo(
    () => tasks.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [tasks],
  );
  const templateById = useMemo(
    () => new Map(workflowTemplates.map((item) => [item.id, item])),
    [workflowTemplates],
  );
  const [verdictSourceStatsLoading, setVerdictSourceStatsLoading] = useState(false);
  const [verdictSourceStatsError, setVerdictSourceStatsError] = useState<string | null>(null);
  const [verdictSourceStats, setVerdictSourceStats] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setVerdictSourceStatsLoading(true);
    setVerdictSourceStatsError(null);
    void (async () => {
      try {
        const rows = await getAcceptanceVerdictSourceStats();
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const row of rows) {
          const key = row.verdictSource.trim() || "unknown";
          next[key] = row.count;
        }
        setVerdictSourceStats(next);
      } catch (error) {
        if (cancelled) return;
        setVerdictSourceStats({});
        setVerdictSourceStatsError(error instanceof Error ? error.message : "加载 verdictSource 统计失败");
      } finally {
        if (!cancelled) setVerdictSourceStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks.length]);

  const verdictSourceStatsDisplay = useMemo(() => {
    const rows = [
      { key: "complete_payload", label: "Structured", color: "success" as const },
      { key: "output_fallback", label: "Fallback", color: "warning" as const },
      { key: "unknown", label: "Unknown", color: "default" as const },
    ];
    const total = Object.values(verdictSourceStats).reduce((sum, value) => sum + value, 0);
    return rows
      .map((item) => {
        const count = verdictSourceStats[item.key] ?? 0;
        const ratio = total > 0 ? `${((count / total) * 100).toFixed(0)}%` : "-";
        return { ...item, count, ratio };
      })
      .filter((item) => item.count > 0 || item.key !== "unknown");
  }, [verdictSourceStats]);

  function parseStageIndexFromEvent(event: WorkflowTaskEventItem): number | null {
    if (!event.payloadJson) return null;
    try {
      const payload = JSON.parse(event.payloadJson) as {
        currentStageIndex?: number;
        toStageIndex?: number;
        fromStageIndex?: number;
      };
      if (typeof payload.toStageIndex === "number") return payload.toStageIndex;
      if (typeof payload.currentStageIndex === "number") return payload.currentStageIndex;
      if (typeof payload.fromStageIndex === "number") return payload.fromStageIndex;
      return null;
    } catch {
      return null;
    }
  }

  function verdictEventStatusTag(event: WorkflowTaskEventItem): { color: string; text: string } | null {
    if (event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED) {
      return { color: "warning", text: "待人工" };
    }
    if (event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED) {
      if (!event.payloadJson) {
        return { color: "default", text: "判定" };
      }
      try {
        const payload = JSON.parse(event.payloadJson) as { workflowAcceptanceVerdict?: string };
        const v = payload.workflowAcceptanceVerdict?.trim();
        if (v === "approve") return { color: "success", text: "通过" };
        if (v === "reject") return { color: "error", text: "驳回" };
        return { color: "default", text: "判定" };
      } catch {
        return null;
      }
    }
    return null;
  }

  function formatEventLabel(event: WorkflowTaskEventItem): string {
    if (!event.payloadJson) {
      return event.eventType;
    }
    try {
      const payload = JSON.parse(event.payloadJson) as {
        employeeId?: string;
        reason?: string;
        action?: string;
        workflowAcceptanceVerdict?: "approve" | "reject";
        snapshot?: {
          phase?: "dispatch" | "decision";
          toNodeName?: string;
          decision?: "pass" | "reject";
          inputPreview?: string;
          outputPreview?: string;
        };
        snapshotId?: string;
        outputPreview?: string;
        graphNodeId?: string;
        source?: string;
      };
      if (event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED) {
        const verdictText =
          payload.workflowAcceptanceVerdict === "approve"
            ? "通过"
            : payload.workflowAcceptanceVerdict === "reject"
              ? "驳回"
              : "未知";
        const nodeText = payload.graphNodeId?.trim() ? `节点 ${payload.graphNodeId.trim()}` : "未知节点";
        return `验收判定 | ${verdictText} | ${nodeText}`;
      }
      if (event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED) {
        const reason = payload.reason?.trim() || "未解析到结构化结论";
        const nodeText = payload.graphNodeId?.trim() ? `节点 ${payload.graphNodeId.trim()}` : "未知节点";
        return `验收待人工 | ${nodeText} | ${reason}`;
      }
      if (event.eventType === "workflow_runtime_snapshot") {
        const snapshot = payload.snapshot;
        if (!snapshot) {
          return "运行时快照";
        }
        if (snapshot.phase === "dispatch") {
          const nodeName = snapshot.toNodeName?.trim() || "未知节点";
          const input = snapshot.inputPreview?.trim() || "(空)";
          return `派发至 ${nodeName} | 输入：${input}`;
        }
        if (snapshot.phase === "decision") {
          const decisionText = snapshot.decision === "pass" ? "通过" : "驳回";
          const output = snapshot.outputPreview?.trim() || "(空)";
          return `决策：${decisionText} | 输出：${output}`;
        }
      }
      if (event.eventType === "workflow_runtime_snapshot_update") {
        const output = payload.outputPreview?.trim() || "(空)";
        return `输出回填 | ${output}`;
      }
      if (event.eventType === "workflow_runtime_dispatch_error") {
        const name = payload.employeeId || (payload as { employeeName?: string }).employeeName || "未知员工";
        const reason = payload.reason?.trim() || "分发失败";
        return `派发失败 | ${name} | ${reason}`;
      }
      const operatorName = payload.employeeId
        ? employees.find((item) => item.id === payload.employeeId)?.name ?? payload.employeeId
        : "";
      const reasonText = payload.reason?.trim();
      return [payload.action ?? event.eventType, operatorName, reasonText]
        .filter(Boolean)
        .join(" | ");
    } catch {
      return event.eventType;
    }
  }

  return (
    <div className="app-workflow-task-timeline">
      <Space style={{ marginBottom: 8 }} wrap>
        {showTitle ? <Typography.Text type="secondary">任务时间线</Typography.Text> : null}
        <Select
          size="small"
          value={employeeId}
          placeholder="审批员工"
          style={{ width: 160 }}
          options={employees.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }))}
          onChange={setEmployeeId}
        />
        <Space size={4} wrap className="app-workflow-task-timeline__verdict-stats">
          <Tag color="blue">
            模式：
            {workflowVerdictMode === "structured_plus_extractor"
              ? "Structured+Fallback"
              : workflowVerdictMode === "structured_only"
                ? "StructuredOnly"
                : "Heuristic"}
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            门闸来源：
          </Typography.Text>
          {verdictSourceStatsLoading ? (
            <Tag>加载中</Tag>
          ) : verdictSourceStatsError ? (
            <Tag color="error">统计失败</Tag>
          ) : verdictSourceStatsDisplay.length === 0 ? (
            <Tag>暂无数据</Tag>
          ) : (
            verdictSourceStatsDisplay.map((item) => (
              <Tag key={item.key} color={item.color}>
                {item.label} {item.count} ({item.ratio})
              </Tag>
            ))
          )}
        </Space>
      </Space>
      {activeTasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
      ) : (
        <List
          size="small"
          dataSource={activeTasks}
          renderItem={(task) => {
            const events = eventsByTaskId[task.id] ?? [];
            const pendingEmployees = taskPendingEmployeesByTaskId[task.id] ?? [];
            const template = templateById.get(task.workflowId);
            const runtimeSnapshots = (runtimeSnapshotsByTaskId[task.id] ?? []).slice(-3).reverse();
            const stage = template?.stages.find((item) => item.stageOrder === task.currentStageIndex);
            const stageName = stage?.name ?? `阶段 ${task.currentStageIndex + 1}`;
            const passRuleLabel = stage?.passRule === "ANY_APPROVE" ? "任一通过" : "全部通过";
            const latestEvent = events[events.length - 1];
            const filterStageIndex = focusedStageIndexByTaskId[task.id] ?? null;
            const filteredEvents = filterStageIndex == null
              ? events
              : events.filter((event) => parseStageIndexFromEvent(event) === filterStageIndex);
            const recentEvents = (expandedEventsByTaskId[task.id] ? filteredEvents : filteredEvents.slice(-3)).slice().reverse();
            const latestEventText = latestEvent ? formatEventLabel(latestEvent) : "";
            return (
              <List.Item>
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Space>
                    <Typography.Text strong>{task.title}</Typography.Text>
                    <Tag>{task.status}</Tag>
                    <Tag color="blue">{stageName}</Tag>
                    <Tag color="purple">{passRuleLabel}</Tag>
                  </Space>
                  {pendingEmployees.length > 0 && (
                    <Space size={4} wrap>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>待审批：</Typography.Text>
                      {pendingEmployees.map((item) => (
                        <Tag key={`${task.id}-${item.employeeId}`}>{item.name}</Tag>
                      ))}
                    </Space>
                  )}
                  <Space>
                    <Button
                      size="small"
                      disabled={!employeeId || task.status !== "in_progress" || !pendingEmployees.some((item) => item.employeeId === employeeId)}
                      onClick={() => employeeId && onDecision({ taskId: task.id, employeeId, decision: "approved" })}
                    >
                      通过
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={!employeeId || task.status !== "in_progress" || !pendingEmployees.some((item) => item.employeeId === employeeId)}
                      onClick={() => {
                        setRejectingTaskId(task.id);
                        setRejectReason("");
                      }}
                    >
                      退回
                    </Button>
                  </Space>
                  {events.length > 0 && (
                    <Space orientation="vertical" size={2}>
                      <Space size={6}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          最近事件（点击可定位阶段）：
                        </Typography.Text>
                        {filteredEvents.length > 3 && (
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 0, height: "auto" }}
                            onClick={() => {
                              setExpandedEventsByTaskId((prev) => ({ ...prev, [task.id]: !prev[task.id] }));
                            }}
                          >
                            {expandedEventsByTaskId[task.id] ? "收起" : `展开${filteredEvents.length}条`}
                          </Button>
                        )}
                        {filterStageIndex != null && (
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 0, height: "auto" }}
                            onClick={() => {
                              setFocusedStageIndexByTaskId((prev) => ({ ...prev, [task.id]: null }));
                            }}
                          >
                            清除过滤
                          </Button>
                        )}
                      </Space>
                      {recentEvents.map((event) => {
                        const eventStageIndex = parseStageIndexFromEvent(event);
                        const label = event.id === latestEvent?.id ? latestEventText : formatEventLabel(event);
                        const verdictTag = verdictEventStatusTag(event);
                        return (
                          <Button
                            key={event.id}
                            type="link"
                            size="small"
                            style={{ paddingInline: 0, height: "auto" }}
                            disabled={eventStageIndex == null}
                            onClick={() => {
                              setFocusedStageIndexByTaskId((prev) => ({ ...prev, [task.id]: eventStageIndex }));
                            }}
                          >
                            <Space size={6} align="center">
                              {verdictTag ? (
                                <Tag color={verdictTag.color} style={{ margin: 0, flexShrink: 0 }}>
                                  {verdictTag.text}
                                </Tag>
                              ) : null}
                              <span>{label}</span>
                            </Space>
                          </Button>
                        );
                      })}
                    </Space>
                  )}
                  {runtimeSnapshots.length > 0 && (
                    <Space orientation="vertical" size={2}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        流转快照（最近3次）：
                      </Typography.Text>
                      {runtimeSnapshots.map((item) => {
                        const head = item.phase === "dispatch"
                          ? `派发 -> ${item.toNodeName ?? item.toNodeId ?? "未知节点"}`
                          : `决策 ${item.decision === "pass" ? "通过" : "驳回"}`;
                        return (
                          <Space key={item.id} orientation="vertical" size={0}>
                            <Typography.Text style={{ fontSize: 12 }}>{head}</Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              输入：{item.inputPreview}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              输出：{item.outputPreview}
                            </Typography.Text>
                          </Space>
                        );
                      })}
                    </Space>
                  )}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
      <Modal
        title="退回原因"
        open={Boolean(rejectingTaskId)}
        okText="确认退回"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: submittingReject, disabled: rejectReason.trim().length === 0 }}
        onCancel={() => {
          if (submittingReject) return;
          setRejectingTaskId(null);
          setRejectReason("");
        }}
        onOk={async () => {
          if (!rejectingTaskId || !employeeId) return;
          const trimmed = rejectReason.trim();
          if (!trimmed) return;
          setSubmittingReject(true);
          try {
            await onDecision({
              taskId: rejectingTaskId,
              employeeId,
              decision: "rejected",
              reason: trimmed,
            });
            setRejectingTaskId(null);
            setRejectReason("");
          } finally {
            setSubmittingReject(false);
          }
        }}
      >
        <Input.TextArea
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="请填写退回原因（必填）"
          autoSize={{ minRows: 3, maxRows: 6 }}
        />
      </Modal>
    </div>
  );
}
