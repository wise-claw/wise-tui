import { BranchesOutlined, NodeIndexOutlined, TeamOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
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
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [canvasEditorOpen, setCanvasEditorOpen] = useState(false);

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
    if (!open) {
      setCanvasEditorOpen(false);
      return;
    }
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
      closeCanvasEditor();
    }
  }, [templates, editingTemplateId]);

  function resetEditorState() {
    setEditingTemplateId(null);
    setEditingProjectIds([]);
    setCanvasSnapshot(createDefaultCanvasSnapshot());
    setValidationErrors([]);
    form.setFieldsValue({ name: "", isDefault: false });
  }

  function closeCanvasEditor() {
    setCanvasEditorOpen(false);
    resetEditorState();
  }

  function openNewProtocolEditor() {
    resetEditorState();
    setCanvasEditorOpen(true);
  }

  async function handleSave() {
    try {
      const values = form.getFieldsValue(["name", "isDefault"]) as { name?: string; isDefault?: boolean };
      const normalizedName = (values.name ?? "").trim();
      if (!normalizedName) {
        message.warning("请输入工作流名称");
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
        const successText = `工作流「${savedTemplate.name}」草稿已保存。`;
        message.success(successText);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知错误";
        message.error(`工作流已保存，但工作流画布保存失败：${messageText}`);
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
        message.warning("请输入工作流名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个智能体阶段后再发布工作流。";
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
      const successText = `工作流「${savedTemplate.name}」已发布。`;
      message.success(successText);
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `发布工作流失败：${messageText}`;
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
    setCanvasEditorOpen(true);
  }

  async function handleDeleteTemplate(workflowId: string) {
    await onDeleteTemplate(workflowId);
    setGraphStatusByWorkflowId((prev) => {
      const next = { ...prev };
      delete next[workflowId];
      return next;
    });
    if (editingTemplateId === workflowId) {
      closeCanvasEditor();
    }
  }

  const content = (
    <div className="app-workflow-config-shell">
      <div className="app-workflow-config-layout app-workflow-config-layout--library-only">
        <aside className="app-workflow-config-sidebar" aria-label="工作流库">
          <div className="app-workflow-config-sidebar-header">
            <div className="app-workflow-config-sidebar-heading">
              <Typography.Text strong>工作流库</Typography.Text>
              <Typography.Text type="secondary" className="app-workflow-config-sidebar-count">
                {templates.length}
              </Typography.Text>
            </div>
            <Button
              size="small"
              type={canvasEditorOpen && !editingTemplateId ? "primary" : "default"}
              onClick={openNewProtocolEditor}
              className="app-workflow-config-create-btn"
            >
              新建工作流
            </Button>
          </div>
          <div className="app-workflow-config-filter-row">
            <Input.Search
              size="small"
              allowClear
              placeholder="搜索工作流"
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
          <div className="app-workflow-config-protocol-list">
            {templates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作流" />
            ) : filteredTemplates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配结果" />
            ) : (
              filteredTemplates.map((row) => {
                const status = graphStatusByWorkflowId[row.id] ?? "none";
                const active = canvasEditorOpen && editingTemplateId === row.id;
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    className={`app-workflow-config-protocol-item${active ? " app-workflow-config-protocol-item--active" : ""}`}
                    onClick={() => startEditingTemplate(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void startEditingTemplate(row);
                      }
                    }}
                  >
                    <div className="app-workflow-config-protocol-item__main">
                      <Typography.Text strong ellipsis className="app-workflow-config-protocol-item__name">
                        {row.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="app-workflow-config-protocol-item__meta">
                        {row.stages.length} 个阶段
                      </Typography.Text>
                    </div>
                    <div className="app-workflow-config-protocol-item__footer">
                      <Space size={4} wrap className="app-workflow-config-protocol-item__tags">
                        {row.isDefault ? <Tag color="gold">默认</Tag> : null}
                        {status === "published" ? <Tag color="success">已发布</Tag> : null}
                        {status === "draft" ? <Tag color="processing">草稿</Tag> : null}
                        {status === "unknown" ? <Tag color="warning">未知</Tag> : null}
                        {status === "none" ? <Tag>未生成</Tag> : null}
                      </Space>
                      <Popconfirm
                        title="确认删除该工作流？"
                        onConfirm={() => handleDeleteTemplate(row.id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button
                          size="small"
                          danger
                          type="link"
                          className="app-workflow-config-protocol-item__delete"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      <Modal
        title={editingTemplate ? `编辑工作流 · ${editingTemplate.name}` : "新建工作流"}
        open={canvasEditorOpen}
        onCancel={closeCanvasEditor}
        footer={null}
        width="100vw"
        rootClassName="app-workflow-config-canvas-modal-root"
        destroyOnHidden
        centered={false}
        zIndex={1100}
        getContainer={() => document.body}
        styles={{
          wrapper: {
            width: "100vw",
            maxWidth: "100vw",
            margin: 0,
            top: 0,
            paddingBottom: 0,
          },
          content: {
            height: "100vh",
            minHeight: "100vh",
            borderRadius: 0,
            display: "flex",
            flexDirection: "column",
          },
          header: { flex: "0 0 auto", marginBottom: 0 },
          body: {
            flex: 1,
            minHeight: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
          mask: { width: "100vw", height: "100vh" },
        }}
      >
        <main className="app-workflow-config-workspace app-workflow-config-workspace--fullscreen">
          <header className="app-workflow-config-toolbar">
            <div className="app-workflow-config-toolbar__head">
              <div className="app-workflow-config-toolbar__identity">
                <Typography.Text className="app-workflow-config-toolbar__eyebrow">工作流画布</Typography.Text>
                <Typography.Text strong className="app-workflow-config-toolbar__title">
                  {editingTemplate ? editingTemplate.name : "新建工作流"}
                </Typography.Text>
              </div>
              <Space size={6} wrap className="app-workflow-config-toolbar__stats">
                <Tag icon={<NodeIndexOutlined />}>{canvasStageCount} 阶段</Tag>
                <Tag icon={<BranchesOutlined />}>{canvasFlowEdgeCount} 连线</Tag>
                <Tag icon={<TeamOutlined />}>{canvasAssignedAgentRoleCount} 角色</Tag>
                {currentGraphStatus === "published" ? <Tag color="success">已发布</Tag> : null}
                {currentGraphStatus === "draft" ? <Tag color="processing">草稿</Tag> : null}
                {currentGraphStatus === "unknown" ? <Tag color="warning">状态未知</Tag> : null}
                {currentGraphStatus === "none" ? <Tag>未生成</Tag> : null}
              </Space>
            </div>

            <Form
              form={form}
              layout="inline"
              initialValues={{ name: "", isDefault: false }}
              className="app-workflow-config-toolbar__form"
            >
              <div className="app-workflow-config-toolbar__fields">
                <div className="app-workflow-config-toolbar__field">
                  <span className="app-workflow-config-toolbar__label">工作流名称</span>
                  <Form.Item name="name">
                    <Input placeholder="输入工作流名称" className="app-workflow-config-name-input" />
                  </Form.Item>
                </div>
                <div className="app-workflow-config-toolbar__field app-workflow-config-toolbar__field--switch">
                  <span className="app-workflow-config-toolbar__label">默认工作流</span>
                  <Form.Item name="isDefault" valuePropName="checked">
                    <Switch checkedChildren="是" unCheckedChildren="否" />
                  </Form.Item>
                </div>
                {projects && projects.length > 0 ? (
                  <div className="app-workflow-config-toolbar__field app-workflow-config-toolbar__field--projects">
                    <span className="app-workflow-config-toolbar__label">所属工作区</span>
                    <Form.Item>
                      <Select
                        mode="multiple"
                        allowClear
                        placeholder="选择工作区"
                        maxTagCount="responsive"
                        value={editingProjectIds}
                        onChange={(value: string[]) => setEditingProjectIds(value)}
                        options={projects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                        className="app-workflow-config-project-select"
                      />
                    </Form.Item>
                  </div>
                ) : null}
              </div>
              <div className="app-workflow-config-toolbar__actions">
                <Button size="small" type="primary" loading={loading} onClick={() => void handleSave()}>
                  {editingTemplate ? "保存草稿" : "创建草稿"}
                </Button>
                <Button size="small" loading={loading} onClick={() => void handlePublish()}>
                  发布工作流
                </Button>
                <Button size="small" onClick={closeCanvasEditor}>
                  关闭
                </Button>
              </div>
            </Form>
          </header>

          {validationErrors.length > 0 && (
            <Alert
              className="app-workflow-config-validation-alert"
              type="error"
              showIcon
              message="工作流画布校验未通过"
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

          <div className="app-workflow-config-canvas-shell">
            <WorkflowCanvasEditorImpl
              key={editingTemplateId ?? "new-delegation-workflow"}
              value={canvasSnapshot}
              onChange={setCanvasSnapshot}
              employees={employees}
              selectableEmployeeIds={selectableEmployeeIds}
              repositoryPath={repositoryPath}
            />
          </div>
        </main>
      </Modal>
    </div>
  );

  if (inline) {
    if (!open) return null;
    return <div className="app-workflow-config-inline-root">{content}</div>;
  }

  return (
    <Modal
      title="工作流"
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
