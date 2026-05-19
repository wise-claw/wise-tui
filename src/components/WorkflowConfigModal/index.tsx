import {
  ApartmentOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CrownOutlined,
  NodeIndexOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  EmployeeItem,
  WorkflowGraph,
  WorkflowTemplateItem,
  WorkflowTemplateStage,
} from "../../types";
import type { WorkflowGraphItem, WorkflowGraphValidationError, WorkflowGraphValidationResult } from "../../services/workflowGraphs";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { createDefaultCanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { WorkflowCanvasEditor as WorkflowCanvasEditorImpl } from "./WorkflowCanvasEditor";
import {
  canvasSnapshotToStages as canvasSnapshotToStagesImpl,
  canvasSnapshotToWorkflowGraph as canvasSnapshotToWorkflowGraphImpl,
  workflowGraphToCanvasSnapshot as workflowGraphToCanvasSnapshotImpl,
} from "./workflowGraphMapping";
import { getWorkflowValidationGroupTitle as getWorkflowValidationGroupTitleImpl, getWorkflowValidationSuggestion as getWorkflowValidationSuggestionImpl } from "./workflowValidationCopy";
import "./index.css";

type GraphStatus = "published" | "draft" | "unknown" | "none";

const DELEGATION_LOOP_STEPS = [
  {
    icon: <CrownOutlined />,
    title: "任务拆解",
    description: "负责人把需求拆成阶段任务、依赖关系和交付标准。",
  },
  {
    icon: <TeamOutlined />,
    title: "角色委派",
    description: "为每个阶段绑定智能体角色、上下文和成果责任。",
  },
  {
    icon: <CheckCircleOutlined />,
    title: "验收流转",
    description: "画布校验、阶段验收、草稿和发布状态集中处理。",
  },
  {
    icon: <ApartmentOutlined />,
    title: "工作区分发",
    description: "把协议绑定到工作区范围，供当前任务上下文复用。",
  },
] satisfies Array<{ icon: ReactNode; title: string; description: string }>;

interface Props {
  open: boolean;
  inline?: boolean;
  loading: boolean;
  employees: EmployeeItem[];
  templates: WorkflowTemplateItem[];
  projects?: { id: string; name: string }[];
  /** workflowId -> [projectId, ...] map loaded from backend */
  workflowProjectIds?: Record<string, string[]>;
  onClose: () => void;
  onSaveTemplate: (input: {
    workflowId?: string;
    name: string;
    isDefault: boolean;
    stages: WorkflowTemplateStage[];
    projectIds?: string[];
  }) => Promise<WorkflowTemplateItem>;
  onLoadGraphItem: (workflowId: string) => Promise<WorkflowGraphItem | null>;
  onSaveGraph: (input: { workflowId: string; graph: WorkflowGraph; status?: "draft" | "published" }) => Promise<void>;
  onValidateGraph: (graph: WorkflowGraph) => Promise<WorkflowGraphValidationResult>;
  onDeleteTemplate: (workflowId: string) => Promise<void>;
  repositoryPath?: string | null;
  selectableEmployeeIds?: string[];
  initialWorkflowId?: string | null;
}


export function WorkflowConfigModal({
  open,
  inline = false,
  loading,
  employees,
  templates,
  projects,
  workflowProjectIds = {},
  onClose,
  onSaveTemplate,
  onLoadGraphItem,
  onSaveGraph,
  onValidateGraph,
  onDeleteTemplate,
  repositoryPath,
  selectableEmployeeIds = [],
  initialWorkflowId = null,
}: Props) {
  const [form] = Form.useForm();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingProjectIds, setEditingProjectIds] = useState<string[]>([]);
  const [canvasSnapshot, setCanvasSnapshot] = useState<CanvasSnapshot>(createDefaultCanvasSnapshot());
  const editingLoadSeqRef = useRef(0);
  const [validationErrors, setValidationErrors] = useState<WorkflowGraphValidationResult["errors"]>([]);
  const [graphStatusByWorkflowId, setGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const [teamKeyword, setTeamKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<GraphStatus | "all">("all");

  const selectableEmployeeIdSet = useMemo(() => new Set(selectableEmployeeIds), [selectableEmployeeIds]);
  const enabledAgentRoleCount = useMemo(
    () => employees.filter((employee) => employee.enabled && selectableEmployeeIdSet.has(employee.id)).length,
    [employees, selectableEmployeeIdSet],
  );
  const templateStatusSummary = useMemo(() => {
    return templates.reduce(
      (summary, template) => {
        const status = (graphStatusByWorkflowId[template.id] ?? "none") as GraphStatus;
        summary[status] += 1;
        return summary;
      },
      { published: 0, draft: 0, unknown: 0, none: 0 } satisfies Record<GraphStatus, number>,
    );
  }, [graphStatusByWorkflowId, templates]);
  const stageCount = useMemo(
    () => templates.reduce((total, template) => total + template.stages.length, 0),
    [templates],
  );
  const workflowProjectLinkCount = useMemo(
    () => new Set(Object.values(workflowProjectIds).flat()).size,
    [workflowProjectIds],
  );
  const canvasStageCount = useMemo(
    () => canvasSnapshot.nodes.filter((node) => node.kind === "material").length,
    [canvasSnapshot.nodes],
  );
  const canvasAssignedAgentRoleCount = useMemo(
    () => new Set(
      canvasSnapshot.nodes
        .filter((node) => node.kind === "material")
        .map((node) => node.employeeId?.trim())
        .filter((employeeId): employeeId is string => Boolean(employeeId)),
    ).size,
    [canvasSnapshot.nodes],
  );
  const canvasFlowEdgeCount = canvasSnapshot.edges.length;
  const currentGraphStatus = editingTemplateId ? graphStatusByWorkflowId[editingTemplateId] ?? "none" : "none";
  const readyTemplateCount = templateStatusSummary.published + templateStatusSummary.draft;
  const editingTemplate = useMemo(
    () => templates.find((item) => item.id === editingTemplateId) ?? null,
    [templates, editingTemplateId],
  );
  const groupedValidationErrors = useMemo(() => {
    const grouped = new Map<string, WorkflowGraphValidationError[]>();
    for (const error of validationErrors) {
      const group = getWorkflowValidationGroupTitleImpl(error.code);
      const current = grouped.get(group) ?? [];
      current.push(error);
      grouped.set(group, current);
    }
    return Array.from(grouped.entries());
  }, [validationErrors]);

  useEffect(() => {
    if (!open) return;
    const workflowId = initialWorkflowId?.trim() ?? "";
    if (!workflowId) return;
    if (editingTemplateId === workflowId) return;
    const template = templates.find((item) => item.id === workflowId);
    if (template) {
      void startEditingTemplate(template);
    }
  }, [open, initialWorkflowId, templates, editingTemplateId]);

  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: "全部" },
      { value: "published", label: "已发布" },
      { value: "draft", label: "草稿" },
      { value: "unknown", label: "未知" },
      { value: "none", label: "未生成" },
    ],
    [],
  );
  const filteredTemplates = useMemo(() => {
    const keyword = teamKeyword.trim().toLowerCase();
    return templates.filter((item) => {
      const nameMatch = !keyword || item.name.toLowerCase().includes(keyword);
      const status = (graphStatusByWorkflowId[item.id] ?? "none") as GraphStatus;
      const statusMatch = statusFilter === "all" || status === statusFilter;
      return nameMatch && statusMatch;
    });
  }, [graphStatusByWorkflowId, statusFilter, teamKeyword, templates]);

  useEffect(() => {
    if (!open || templates.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        templates.map(async (template) => {
          try {
            const item = await onLoadGraphItem(template.id);
            return [template.id, item?.status ?? "none"] as const;
          } catch {
            return [template.id, "unknown"] as const;
          }
        }),
      );
      if (!cancelled) {
        setGraphStatusByWorkflowId(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, templates, onLoadGraphItem]);

  useEffect(() => {
    if (!editingTemplateId) return;
    const stillExists = templates.some((item) => item.id === editingTemplateId);
    if (!stillExists) {
      resetEditor();
    }
  }, [templates, editingTemplateId]);

  function resetEditor() {
    setEditingTemplateId(null);
    setEditingProjectIds([]);
    setCanvasSnapshot(createDefaultCanvasSnapshot());
    setValidationErrors([]);
    form.setFieldsValue({ name: "", isDefault: false });
  }

  async function handleSave() {
    try {
      const values = form.getFieldsValue(["name", "isDefault"]) as { name?: string; isDefault?: boolean };
      const normalizedName = (values.name ?? "").trim();
      if (!normalizedName) {
        message.warning("请输入协议名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个智能体阶段后再保存草稿。";
        message.error(warning);
        return;
      }
      const validation = await onValidateGraph(graph);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        return;
      }
      const savedTemplate = await onSaveTemplate({
        workflowId: editingTemplate?.id,
        name: normalizedName,
        isDefault: Boolean(values.isDefault),
        stages,
        projectIds: editingProjectIds,
      });
      try {
        await onSaveGraph({ workflowId: savedTemplate.id, graph, status: "draft" });
        setGraphStatusByWorkflowId((prev) => ({ ...prev, [savedTemplate.id]: "draft" }));
        const successText = `委派协议「${savedTemplate.name}」草稿已保存。`;
        message.success(successText);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知错误";
        message.error(`协议已保存，但委派画布保存失败：${messageText}`);
      }
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `保存草稿失败：${messageText}`;
      message.error(warning);
    }
  }

  async function handlePublish() {
    try {
      const values = form.getFieldsValue(["name", "isDefault"]) as { name?: string; isDefault?: boolean };
      const normalizedName = (values.name ?? "").trim();
      if (!normalizedName) {
        message.warning("请输入协议名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个智能体阶段后再发布协议。";
        message.error(warning);
        return;
      }
      const validation = await onValidateGraph(graph);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        return;
      }
      const savedTemplate = await onSaveTemplate({
        workflowId: editingTemplate?.id,
        name: normalizedName,
        isDefault: Boolean(values.isDefault),
        stages,
        projectIds: editingProjectIds,
      });
      await onSaveGraph({ workflowId: savedTemplate.id, graph, status: "published" });
      setGraphStatusByWorkflowId((prev) => ({ ...prev, [savedTemplate.id]: "published" }));
      const successText = `委派协议「${savedTemplate.name}」已发布。`;
      message.success(successText);
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `发布协议失败：${messageText}`;
      message.error(warning);
    }
  }

  async function startEditingTemplate(row: WorkflowTemplateItem) {
    const currentSeq = editingLoadSeqRef.current + 1;
    editingLoadSeqRef.current = currentSeq;
    setEditingTemplateId(row.id);
    setValidationErrors([]);
    setCanvasSnapshot(createDefaultCanvasSnapshot());
    try {
      const graphItem = await onLoadGraphItem(row.id);
      if (editingLoadSeqRef.current !== currentSeq) return;
      setCanvasSnapshot(workflowGraphToCanvasSnapshotImpl(graphItem?.graph));
    } catch {
      if (editingLoadSeqRef.current !== currentSeq) return;
      setCanvasSnapshot(createDefaultCanvasSnapshot());
    }
    if (editingLoadSeqRef.current !== currentSeq) return;
    form.setFieldsValue({
      name: row.name,
      isDefault: row.isDefault,
    });
    setEditingProjectIds(workflowProjectIds[row.id] ?? []);
  }

  async function handleDeleteTemplate(workflowId: string) {
    await onDeleteTemplate(workflowId);
    setGraphStatusByWorkflowId((prev) => {
      const next = { ...prev };
      delete next[workflowId];
      return next;
    });
    if (editingTemplateId === workflowId) {
      resetEditor();
    }
  }

  const content = (
    <div className="app-workflow-config-shell">
      <section className="app-workflow-config-hero" aria-label="委派协议控制台">
        <div>
          <Typography.Text className="app-workflow-config-hero__eyebrow">
            多智能体委派协议
          </Typography.Text>
          <Typography.Title level={4} className="app-workflow-config-hero__title">
            委派协议控制台
          </Typography.Title>
          <Typography.Paragraph className="app-workflow-config-hero__subtitle">
            把负责人到智能体角色的任务拆解、阶段验收、工作区绑定和发布状态集中管理。画布保留原有编排能力，
            入口语义收敛为多智能体协作协议。
          </Typography.Paragraph>
        </div>
        <div className="app-workflow-config-hero__meter">
          <strong>{readyTemplateCount}/{templates.length}</strong>
          <span>可运行协议</span>
        </div>
      </section>

      <div className="app-workflow-config-summary" aria-label="委派协议状态">
        <WorkflowMetric icon={<BranchesOutlined />} label="协议模板" value={templates.length} />
        <WorkflowMetric icon={<NodeIndexOutlined />} label="累计阶段" value={stageCount} />
        <WorkflowMetric icon={<CheckCircleOutlined />} label="已发布" value={templateStatusSummary.published} />
        <WorkflowMetric icon={<TeamOutlined />} label="可派发角色" value={enabledAgentRoleCount} />
      </div>

      <div className="app-workflow-config-loop" aria-label="多智能体委派闭环">
        {DELEGATION_LOOP_STEPS.map((step, index) => (
          <div className="app-workflow-config-loop-step" key={step.title}>
            <span className="app-workflow-config-loop-step__index">{index + 1}</span>
            <span className="app-workflow-config-loop-step__icon" aria-hidden>
              {step.icon}
            </span>
            <span className="app-workflow-config-loop-step__body">
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="app-workflow-config-scope-bar" aria-label="当前协议状态">
        <span>当前画布：{canvasStageCount} 个阶段</span>
        <span>{canvasFlowEdgeCount} 条连线</span>
        <span>{canvasAssignedAgentRoleCount} 个已绑定角色</span>
        <span>{workflowProjectLinkCount} 个工作区已挂接协议</span>
      </div>

      <div className="app-workflow-config-layout">
        <div className="app-workflow-config-sidebar">
          <Space orientation="vertical" size={10} className="app-workflow-config-sidebar-space">
            <div className="app-workflow-config-sidebar-header">
              <Typography.Text strong>协议库</Typography.Text>
              <Button
                size="small"
                type={!editingTemplateId ? "primary" : "default"}
                onClick={resetEditor}
                className="app-workflow-config-create-btn"
              >
                新建协议
              </Button>
            </div>
            <div className="app-workflow-config-filter-row">
              <Input.Search
                size="small"
                allowClear
                placeholder="搜索协议名称"
                value={teamKeyword}
                onChange={(event) => setTeamKeyword(event.target.value)}
              />
              <Select
                size="small"
                value={statusFilter}
                options={statusFilterOptions}
                onChange={(value) => setStatusFilter(value)}
                className="app-workflow-config-filter-status"
              />
            </div>
            {templates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无委派协议" />
            ) : filteredTemplates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配结果" />
            ) : (
              filteredTemplates.map((row) => {
                const status = graphStatusByWorkflowId[row.id] ?? "none";
                const active = editingTemplateId === row.id;
                return (
                  <Card
                    key={row.id}
                    size="small"
                    hoverable
                    onClick={() => startEditingTemplate(row)}
                    className={`app-workflow-config-team-card${active ? " app-workflow-config-team-card--active" : ""}`}
                  >
                    <Space orientation="vertical" size={6} className="app-workflow-config-team-card-inner">
                      <div className="app-workflow-config-team-card-title-row">
                        <Typography.Text strong ellipsis className="app-workflow-config-team-card-title">
                          {row.name}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary" className="app-workflow-config-team-card-meta">
                        阶段数：{row.stages.length}
                      </Typography.Text>
                      <div className="app-workflow-config-team-card-actions">
                        <Space size={4} className="app-workflow-config-team-card-tags">
                          {row.isDefault ? <Tag color="gold">默认</Tag> : null}
                          {status === "published" ? <Tag color="success">已发布</Tag> : null}
                          {status === "draft" ? <Tag color="processing">草稿</Tag> : null}
                          {status === "unknown" ? <Tag color="warning">未知</Tag> : null}
                          {status === "none" ? <Tag>未生成</Tag> : null}
                        </Space>
                        <Popconfirm
                          title="确认删除该协议？"
                          onConfirm={() => handleDeleteTemplate(row.id)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button
                            size="small"
                            danger
                            type="link"
                            className="app-workflow-config-team-card-delete"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </Space>
                  </Card>
                );
              })
            )}
          </Space>
        </div>

        <Space orientation="vertical" size={12} className="app-workflow-config-editor">
          <Form
            form={form}
            layout="inline"
            initialValues={{ name: "", isDefault: false }}
            className="app-workflow-config-editor-form"
          >
            <div className="app-workflow-config-editor-form-left">
              <Form.Item name="name">
                <Input placeholder="协议名称" className="app-workflow-config-name-input" />
              </Form.Item>
              <Form.Item name="isDefault" valuePropName="checked">
                <Switch checkedChildren="默认" unCheckedChildren="非默认" />
              </Form.Item>
              {projects && projects.length > 0 && (
                <Form.Item label="所属工作区">
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="所属工作区"
                    maxTagCount="responsive"
                    value={editingProjectIds}
                    onChange={(value: string[]) => setEditingProjectIds(value)}
                    options={projects.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                </Form.Item>
              )}
            </div>
            <div className="app-workflow-config-editor-form-actions">
              <Form.Item>
                <Button size="small" type="primary" loading={loading} onClick={() => void handleSave()}>
                  {editingTemplate ? "保存草稿" : "创建草稿"}
                </Button>
              </Form.Item>
              <Form.Item>
                <Button size="small" loading={loading} onClick={() => void handlePublish()}>
                  发布协议
                </Button>
              </Form.Item>
              {editingTemplate && (
                <Form.Item>
                  <Button size="small" onClick={resetEditor}>
                    取消编辑
                  </Button>
                </Form.Item>
              )}
            </div>
          </Form>

          {validationErrors.length > 0 && (
            <Alert
              className="app-workflow-config-validation-alert"
              type="error"
              showIcon
              message="委派画布校验未通过"
              description={
                <div>
                  {groupedValidationErrors.map(([groupTitle, groupItems]) => (
                    <div key={groupTitle} className="app-workflow-config-error-group">
                      <Typography.Text strong>{groupTitle}</Typography.Text>
                      {groupItems.map((item) => (
                        <div key={`${item.code}-${item.nodeId ?? ""}-${item.edgeId ?? ""}`}>
                          <Typography.Text>
                            [{item.code}] {item.message}
                          </Typography.Text>
                          <Typography.Text type="secondary" className="app-workflow-config-error-suggestion">
                            建议：{getWorkflowValidationSuggestionImpl(item.code)}
                          </Typography.Text>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              }
            />
          )}

          <div className="app-workflow-config-stage-panel">
            <div className="app-workflow-config-stage-header">
              <div>
                <Typography.Text className="app-workflow-config-stage-eyebrow">委派画布</Typography.Text>
                <Typography.Text strong className="app-workflow-config-stage-title">
                  {editingTemplate ? editingTemplate.name : "新建委派协议"}
                </Typography.Text>
              </div>
              <Space size={6} wrap className="app-workflow-config-stage-tags">
                <Tag icon={<NodeIndexOutlined />}>{canvasStageCount} 阶段</Tag>
                <Tag icon={<BranchesOutlined />}>{canvasFlowEdgeCount} 连线</Tag>
                {currentGraphStatus === "published" ? <Tag color="success">已发布</Tag> : null}
                {currentGraphStatus === "draft" ? <Tag color="processing">草稿</Tag> : null}
                {currentGraphStatus === "unknown" ? <Tag color="warning">状态未知</Tag> : null}
                {currentGraphStatus === "none" ? <Tag>未生成</Tag> : null}
              </Space>
            </div>
            <WorkflowCanvasEditorImpl
              key={editingTemplateId ?? "new-delegation-workflow"}
              value={canvasSnapshot}
              onChange={setCanvasSnapshot}
              employees={employees}
              selectableEmployeeIds={selectableEmployeeIds}
              repositoryPath={repositoryPath}
            />
          </div>

        </Space>
      </div>
    </div>
  );

  if (inline) {
    if (!open) return null;
    return <div className="app-workflow-config-inline-root">{content}</div>;
  }

  return (
    <Modal
      title="委派协议"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1080}
      className="app-workflow-config-modal"
      destroyOnHidden
    >
      {content}
    </Modal>
  );
}

interface WorkflowMetricProps {
  icon: ReactNode;
  label: string;
  value: number;
}

function WorkflowMetric({ icon, label, value }: WorkflowMetricProps) {
  return (
    <div className="app-workflow-config-metric">
      <span className="app-workflow-config-metric__icon" aria-hidden>
        {icon}
      </span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}
