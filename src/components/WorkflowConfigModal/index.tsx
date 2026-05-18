import { MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined } from "@ant-design/icons";
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
  Tooltip,
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
  const [teamListCollapsed, setTeamListCollapsed] = useState(false);

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
    if (open) return;
    setTeamListCollapsed(false);
  }, [open]);

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
        message.warning("请输入团队名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个员工阶段后再保存草稿。";
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
        const successText = `模板「${savedTemplate.name}」草稿已保存。`;
        message.success(successText);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "未知错误";
        message.error(`模板已保存，但流程图保存失败：${messageText}`);
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
        message.warning("请输入团队名称");
        return;
      }
      setValidationErrors([]);
      const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
      const graph = canvasSnapshotToWorkflowGraphImpl(canvasSnapshot, fallbackEmployeeId);
      const stages = canvasSnapshotToStagesImpl(canvasSnapshot, employees);
      if (stages.length === 0) {
        const warning = "请至少添加一个员工阶段后再发布模板。";
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
      const successText = `模板「${savedTemplate.name}」已发布。`;
      message.success(successText);
      setEditingTemplateId(savedTemplate.id);
      form.setFieldsValue({ name: savedTemplate.name, isDefault: Boolean(values.isDefault) });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      const warning = `发布失败：${messageText}`;
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

  return (
    <Modal
      title="团队配置"
      open={open}
      onCancel={onClose}
      footer={null}
      centered={false}
      width="100%"
      rootClassName="app-workflow-config-modal-root"
      className="app-workflow-config-modal"
      destroyOnHidden
      styles={{
        body: {
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <div className="app-workflow-config-layout">
        <aside
          className={`app-workflow-config-sidebar${teamListCollapsed ? " app-workflow-config-sidebar--collapsed" : ""}`}
          aria-label="团队列表"
        >
          {teamListCollapsed ? (
            <div className="app-workflow-config-sidebar-collapsed">
              <Tooltip title="展开团队列表" placement="right">
                <Button
                  type="text"
                  size="small"
                  icon={<MenuUnfoldOutlined />}
                  aria-label="展开团队列表"
                  onClick={() => setTeamListCollapsed(false)}
                />
              </Tooltip>
              <Tooltip title="新建团队" placement="right">
                <Button
                  size="small"
                  type={!editingTemplateId ? "primary" : "default"}
                  icon={<PlusOutlined />}
                  aria-label="新建团队"
                  onClick={resetEditor}
                />
              </Tooltip>
              {editingTemplate ? (
                <Tooltip title={editingTemplate.name} placement="right">
                  <span className="app-workflow-config-sidebar-collapsed-active" aria-hidden>
                    {editingTemplate.name.slice(0, 1)}
                  </span>
                </Tooltip>
              ) : null}
            </div>
          ) : (
          <Space orientation="vertical" size={10} className="app-workflow-config-sidebar-space">
            <div className="app-workflow-config-sidebar-header">
              <Typography.Text strong>团队列表</Typography.Text>
              <Space size={4} className="app-workflow-config-sidebar-header-actions">
                <Button
                  size="small"
                  type={!editingTemplateId ? "primary" : "default"}
                  onClick={resetEditor}
                  className="app-workflow-config-create-btn"
                >
                  新建团队
                </Button>
                <Tooltip title="收起团队列表">
                  <Button
                    type="text"
                    size="small"
                    icon={<MenuFoldOutlined />}
                    aria-label="收起团队列表"
                    onClick={() => setTeamListCollapsed(true)}
                  />
                </Tooltip>
              </Space>
            </div>
            <div className="app-workflow-config-filter-row">
              <Input.Search
                size="small"
                allowClear
                placeholder="搜索团队名"
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无团队模板" />
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
                          title="确认删除该团队？"
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
          )}
        </aside>

        <div className="app-workflow-config-editor">
          <Form
            form={form}
            size="small"
            layout="inline"
            initialValues={{ name: "", isDefault: false }}
            className="app-workflow-config-editor-form"
          >
            <div className="app-workflow-config-editor-form-left">
              <Form.Item name="name">
                <Input placeholder="团队名称" className="app-workflow-config-name-input" />
              </Form.Item>
              <Form.Item name="isDefault" valuePropName="checked">
                <Switch checkedChildren="默认" unCheckedChildren="非默认" />
              </Form.Item>
              {projects && projects.length > 0 && (
                <Form.Item label="项目" colon={false}>
                  <Select
                    className="app-workflow-config-project-select"
                    mode="multiple"
                    allowClear
                    placeholder="所属项目"
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
            <Typography.Text type="secondary" ellipsis className="app-workflow-config-stage-tip">
              流程编排：左侧物料、右侧画布；拖拽节点调序，连线定义执行流
            </Typography.Text>
            <div className="app-workflow-config-editor-form-actions">
              <Form.Item>
                <Button size="small" type="primary" loading={loading} onClick={() => void handleSave()}>
                  {editingTemplate ? "保存草稿" : "创建草稿"}
                </Button>
              </Form.Item>
              <Form.Item>
                <Button size="small" loading={loading} onClick={() => void handlePublish()}>
                  发布模板
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
              message="流程图校验未通过"
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
            <WorkflowCanvasEditorImpl
              key={editingTemplateId ?? "new-team-workflow"}
              value={canvasSnapshot}
              onChange={setCanvasSnapshot}
              employees={employees}
              selectableEmployeeIds={selectableEmployeeIds}
              repositoryPath={repositoryPath}
            />
          </div>

        </div>
      </div>
    </Modal>
  );
}
