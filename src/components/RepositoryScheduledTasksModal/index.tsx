import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import { WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED } from "../../constants/workflowUiEvents";
import type { CcWorkflowListItem } from "../../services/ccWorkflowStudioFiles";
import { listCcWorkflowStudioWorkflows } from "../../services/ccWorkflowStudioFiles";
import type { FormInstance } from "antd/es/form";
import type { ColumnsType } from "antd/es/table";
import { CronExpressionParser } from "cron-parser";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeItem, RepositoryScheduledClaudeTask, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { collectTeamMemberEmployeeIds } from "../../utils/collectTeamMemberEmployeeIds";
import {
  formatScheduledTaskDispatchTargetLabel,
  parseScheduledTaskDispatchTargetKey,
  scheduledTaskDispatchTargetKey,
  SCHEDULED_TASK_DISPATCH_MAIN,
} from "../../utils/scheduledTaskDispatchTarget";
import { PromptMilkdownField } from "../PromptMilkdownField";
import {
  initialLastScheduledSlotForCron,
  readRepositoryScheduledClaudeTasks,
  writeRepositoryScheduledClaudeTasks,
  patchRepositoryScheduledClaudeTask,
} from "../../services/repositoryScheduledClaudeTasksStore";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import {
  SCHEDULED_TASK_EXECUTION_KIND_OPTIONS,
  formatScheduledTaskExecutionKindLabel,
  resolveScheduledTaskExecutionKind,
  type ScheduledTaskExecutionKind,
} from "../../utils/scheduledTaskExecution";
import { ScheduledTaskCronField } from "./ScheduledTaskCronField";
import "./index.css";

export type ScheduledTasksPresentation = "modal" | "overlay";

export interface ScheduledTasksOverlayTarget {
  path: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath: string;
  repositoryDisplayName: string;
  employees: EmployeeItem[];
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  /** 主区+右栏叠层（与技能市场一致）；默认 overlay */
  presentation?: ScheduledTasksPresentation;
}

function notifyScheduledTasksChanged(): void {
  window.dispatchEvent(new CustomEvent(WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED));
}

function formatNextRunHint(cronExpression: string): string {
  const c = cronExpression.trim();
  if (!c) return "—";
  try {
    const t = CronExpressionParser.parse(c, { currentDate: new Date() }).next().getTime();
    return new Date(t).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "无效";
  }
}

function newTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `st-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function RepositoryScheduledTasksModal({
  open,
  onClose,
  repositoryPath,
  repositoryDisplayName,
  employees,
  workflowTemplates = [],
  workflowGraphsByWorkflowId = {},
  presentation = "overlay",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<RepositoryScheduledClaudeTask[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RepositoryScheduledClaudeTask | null>(null);
  const [ccWorkflows, setCcWorkflows] = useState<CcWorkflowListItem[]>([]);
  const [ccWorkflowsLoading, setCcWorkflowsLoading] = useState(false);
  const [form] = Form.useForm<{
    title: string;
    cronExpression: string;
    executionKind: ScheduledTaskExecutionKind;
    dispatchTargetKey: string;
    ccWorkflowId: string | null;
    enabled: boolean;
    contentMarkdown: string;
  }>();

  const dispatchableEmployees = useMemo(
    () => employees.filter((e) => !isOmcMonitorEmployeeRecord(e) && e.enabled),
    [employees],
  );

  const teamMemberEmployeeIds = useMemo(
    () => collectTeamMemberEmployeeIds(workflowTemplates, workflowGraphsByWorkflowId),
    [workflowTemplates, workflowGraphsByWorkflowId],
  );

  const watchedDispatchTargetKey = Form.useWatch("dispatchTargetKey", form);
  const watchedExecutionKind = Form.useWatch("executionKind", form) ?? "claude";

  const loadCcWorkflows = useCallback(async () => {
    const path = repositoryPath.trim();
    if (!path) {
      setCcWorkflows([]);
      return;
    }
    setCcWorkflowsLoading(true);
    try {
      setCcWorkflows(await listCcWorkflowStudioWorkflows(path));
    } catch {
      setCcWorkflows([]);
    } finally {
      setCcWorkflowsLoading(false);
    }
  }, [repositoryPath]);
  const scheduledTaskDispatchSelectOptions = useMemo(() => {
    const currentKey =
      typeof watchedDispatchTargetKey === "string" && watchedDispatchTargetKey.trim()
        ? watchedDispatchTargetKey.trim()
        : SCHEDULED_TASK_DISPATCH_MAIN;
    const parsedCurrent = parseScheduledTaskDispatchTargetKey(currentKey);
    const baseEmployees = dispatchableEmployees.filter((e) => !teamMemberEmployeeIds.has(e.id));
    const pinnedEmployee =
      parsedCurrent.type === "employee" &&
      parsedCurrent.employeeId &&
      teamMemberEmployeeIds.has(parsedCurrent.employeeId)
        ? employees.find((e) => e.id === parsedCurrent.employeeId)
        : undefined;
    const employeeOptions = [
      ...(pinnedEmployee
        ? [
            {
              value: scheduledTaskDispatchTargetKey({ employeeId: pinnedEmployee.id }),
              label: `${pinnedEmployee.name}（已在团队流程中，请改选工作流）`,
              disabled: true as const,
            },
          ]
        : []),
      ...baseEmployees.map((e) => ({
        value: scheduledTaskDispatchTargetKey({ employeeId: e.id }),
        label: e.name,
      })),
    ];
    const workflowOptions = workflowTemplates.map((wf) => ({
      value: scheduledTaskDispatchTargetKey({ workflowId: wf.id }),
      label: wf.name.trim() || wf.id,
    }));
    const pinnedWorkflow =
      parsedCurrent.type === "team" &&
      parsedCurrent.workflowId &&
      !workflowTemplates.some((wf) => wf.id === parsedCurrent.workflowId)
        ? [
            {
              value: scheduledTaskDispatchTargetKey({ workflowId: parsedCurrent.workflowId }),
              label: `${parsedCurrent.workflowId}（工作流已不存在）`,
              disabled: true as const,
            },
          ]
        : [];
    return [
      {
        label: "Repo 执行会话",
        options: [{ value: SCHEDULED_TASK_DISPATCH_MAIN, label: "仓库绑定主会话" }],
      },
      {
        label: "执行员工",
        options: employeeOptions,
      },
      {
        label: "团队 / 工作流",
        options: [...pinnedWorkflow, ...workflowOptions],
      },
    ];
  }, [
    dispatchableEmployees,
    employees,
    teamMemberEmployeeIds,
    watchedDispatchTargetKey,
    workflowTemplates,
  ]);

  const reload = useCallback(async () => {
    const path = repositoryPath.trim();
    if (!path) return;
    setLoading(true);
    try {
      const list = await readRepositoryScheduledClaudeTasks(path);
      setTasks(list);
    } catch {
      message.error("读取定时任务失败");
    } finally {
      setLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (open) {
      void reload();
      void loadCcWorkflows();
      setDrawerOpen(false);
      setEditing(null);
    }
  }, [open, reload, loadCcWorkflows]);

  useEffect(() => {
    if (drawerOpen) {
      void loadCcWorkflows();
    }
  }, [drawerOpen, loadCcWorkflows]);

  const openCreate = () => {
    const now = Date.now();
    const draft: RepositoryScheduledClaudeTask = {
      id: newTaskId(),
      title: "",
      cronExpression: "0 9 * * *",
      executionKind: "claude",
      contentMarkdown: "",
      employeeId: null,
      workflowId: null,
      ccWorkflowId: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastScheduledSlotAt: initialLastScheduledSlotForCron("0 9 * * *", now),
    };
    setEditing(draft);
    form.setFieldsValue({
      title: "",
      cronExpression: draft.cronExpression,
      executionKind: "claude",
      dispatchTargetKey: SCHEDULED_TASK_DISPATCH_MAIN,
      ccWorkflowId: null,
      enabled: true,
      contentMarkdown: "",
    });
    setDrawerOpen(true);
  };

  const openEdit = (row: RepositoryScheduledClaudeTask) => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      cronExpression: row.cronExpression,
      executionKind: resolveScheduledTaskExecutionKind(row),
      dispatchTargetKey: scheduledTaskDispatchTargetKey(row),
      ccWorkflowId: row.ccWorkflowId?.trim() || null,
      enabled: row.enabled,
      contentMarkdown: row.contentMarkdown,
    });
    setDrawerOpen(true);
  };

  const handleDismiss = useCallback(() => {
    onClose();
    notifyScheduledTasksChanged();
  }, [onClose]);

  const persistAll = async (next: RepositoryScheduledClaudeTask[]) => {
    await writeRepositoryScheduledClaudeTasks(repositoryPath.trim(), next);
    setTasks(next);
    notifyScheduledTasksChanged();
  };

  const handleSaveForm = async () => {
    const path = repositoryPath.trim();
    if (!path || !editing) return;
    try {
      const v = await form.validateFields();
      const cron = v.cronExpression.trim();
      try {
        CronExpressionParser.parse(cron, { currentDate: new Date() });
      } catch {
        message.error("执行周期无效");
        return;
      }
      const now = Date.now();
      const executionKind = v.executionKind ?? "claude";
      const md = v.contentMarkdown.trim();
      if (executionKind === "claude" && !md) {
        message.error("请填写 Claude 执行内容");
        return;
      }
      if (executionKind === "script" && !md) {
        message.error("请填写脚本内容");
        return;
      }
      const ccWorkflowId = executionKind === "workflow" ? v.ccWorkflowId?.trim() || null : null;
      if (executionKind === "workflow") {
        if (!ccWorkflowId) {
          message.error("请选择 CC 工作流");
          return;
        }
        if (!ccWorkflows.some((wf) => wf.id === ccWorkflowId)) {
          message.error("所选 CC 工作流不存在");
          return;
        }
      }
      const isNew = !tasks.some((t) => t.id === editing.id);
      const slot = initialLastScheduledSlotForCron(cron, now);
      const dispatchParsed =
        executionKind === "claude"
          ? parseScheduledTaskDispatchTargetKey(v.dispatchTargetKey)
          : { type: "main" as const, employeeId: null, workflowId: null };
      const employeeId = executionKind === "claude" ? dispatchParsed.employeeId : null;
      const workflowId = executionKind === "claude" ? dispatchParsed.workflowId : null;
      if (employeeId && teamMemberEmployeeIds.has(employeeId)) {
        message.error("执行员工不能选择已在团队流程中的员工，请改选团队工作流");
        return;
      }
      if (workflowId && !workflowTemplates.some((wf) => wf.id === workflowId)) {
        message.error("所选团队工作流不存在");
        return;
      }
      if (isNew) {
        const nextRow: RepositoryScheduledClaudeTask = {
          ...editing,
          title: v.title.trim() || "未命名任务",
          cronExpression: cron,
          executionKind,
          contentMarkdown: v.contentMarkdown,
          employeeId,
          workflowId,
          ccWorkflowId,
          enabled: v.enabled,
          createdAt: now,
          updatedAt: now,
          lastScheduledSlotAt: slot ?? editing.lastScheduledSlotAt,
        };
        const next = [...tasks, nextRow];
        await persistAll(next);
      } else {
        const prev = tasks.find((t) => t.id === editing.id);
        if (!prev) return;
        const resetSlot = v.enabled && (!prev.enabled || prev.cronExpression.trim() !== cron);
        const merged: RepositoryScheduledClaudeTask = {
          ...prev,
          title: v.title.trim() || "未命名任务",
          cronExpression: cron,
          executionKind,
          contentMarkdown: v.contentMarkdown,
          employeeId,
          workflowId,
          ccWorkflowId,
          enabled: v.enabled,
          updatedAt: now,
          lastScheduledSlotAt: resetSlot ? slot ?? prev.lastScheduledSlotAt : prev.lastScheduledSlotAt,
        };
        const next = tasks.map((t) => (t.id === merged.id ? merged : t));
        await persistAll(next);
      }
      setDrawerOpen(false);
      setEditing(null);
    } catch {
      /* validateFields */
    }
  };

  const handleDelete = async (id: string) => {
    const next = tasks.filter((t) => t.id !== id);
    await persistAll(next);
    if (editing?.id === id) {
      setDrawerOpen(false);
      setEditing(null);
    }
  };

  const handleToggleEnabled = async (row: RepositoryScheduledClaudeTask, enabled: boolean) => {
    const now = Date.now();
    const patch: Partial<RepositoryScheduledClaudeTask> = { enabled };
    if (enabled) {
      patch.lastScheduledSlotAt = initialLastScheduledSlotForCron(row.cronExpression, now);
    }
    const next = await patchRepositoryScheduledClaudeTask(repositoryPath.trim(), row.id, patch);
    setTasks(next);
    notifyScheduledTasksChanged();
  };

  const columns: ColumnsType<RepositoryScheduledClaudeTask> = [
    {
      title: "启动",
      key: "en",
      width: 52,
      render: (_, row) => (
        <Switch size="small" checked={row.enabled} onChange={(c) => void handleToggleEnabled(row, c)} />
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      ellipsis: true,
      render: (t: string) => <Typography.Text ellipsis={{ tooltip: t }}>{t || "—"}</Typography.Text>,
    },
    {
      title: "方式",
      key: "kind",
      width: 88,
      ellipsis: true,
      render: (_, row) => (
        <Tag>{formatScheduledTaskExecutionKindLabel(row)}</Tag>
      ),
    },
    {
      title: "Cron",
      dataIndex: "cronExpression",
      width: 88,
      ellipsis: true,
      render: (c: string) => (
        <Tooltip title={c}>
          <span className="app-scheduled-tasks-modal__cron">{c}</span>
        </Tooltip>
      ),
    },
    {
      title: "下次",
      key: "next",
      width: 100,
      ellipsis: true,
      render: (_, row) => {
        const hint = formatNextRunHint(row.cronExpression);
        return (
          <Tooltip title={hint}>
            <span className="app-scheduled-tasks-modal__mono-muted">{hint}</span>
          </Tooltip>
        );
      },
    },
    {
      title: "执行目标",
      key: "dispatch",
      width: 96,
      ellipsis: true,
      render: (_, row) => {
        const kind = resolveScheduledTaskExecutionKind(row);
        if (kind === "script") {
          return <Tag color="green">仓库 Shell</Tag>;
        }
        if (kind === "workflow") {
          const wfName = ccWorkflows.find((wf) => wf.id === row.ccWorkflowId)?.name ?? row.ccWorkflowId;
          return (
            <Tooltip title={wfName}>
              <Tag color="cyan">CC 工作流</Tag>
            </Tooltip>
          );
        }
        const label = formatScheduledTaskDispatchTargetLabel({
          employeeId: row.employeeId,
          workflowId: row.workflowId,
          employeeName: employees.find((e) => e.id === row.employeeId)?.name,
          workflowName: workflowTemplates.find((wf) => wf.id === row.workflowId)?.name,
        });
        const color = row.workflowId ? "purple" : row.employeeId ? "blue" : "default";
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: "最近",
      key: "last",
      width: 96,
      ellipsis: true,
      render: (_, row) => {
        if (!row.lastExecutedAt) return <span className="app-scheduled-tasks-modal__mono-muted">—</span>;
        const ok = row.lastExecuteOk !== false;
        return (
          <Space size={4} orientation="vertical" style={{ lineHeight: 1.2 }}>
            <Typography.Text type={ok ? "secondary" : "danger"} style={{ fontSize: 11 }}>
              {new Date(row.lastExecutedAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "act",
      width: 96,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="删除此定时任务？" okText="删除" cancelText="取消" onConfirm={() => void handleDelete(row.id)}>
            <Button type="link" size="small" danger style={{ padding: 0 }}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const tableScrollY = tableBodyScrollHeight(presentation);
  const hint = (
    <Typography.Paragraph className="app-scheduled-tasks-panel__hint" style={{ marginBottom: 0 }}>
      按 Cron 在后台触发：支持 Claude 提示词、仓库 Shell 脚本、CC Workflow Studio 工作流（Slash）三种方式。Claude / 工作流需绑定主会话且非空闲时跳过；脚本在仓库根目录执行。应用需保持运行。
    </Typography.Paragraph>
  );
  const tableNode = (
    <Table<RepositoryScheduledClaudeTask>
      size="small"
      rowKey="id"
      loading={loading}
      className="app-scheduled-tasks-panel__table"
      tableLayout="fixed"
      pagination={false}
      scroll={{ y: tableScrollY }}
      columns={columns}
      dataSource={tasks}
      locale={{ emptyText: "暂无定时任务" }}
    />
  );

  const listBody = presentation === "overlay" ? (
    <div className="app-scheduled-tasks-hub-root">
      <header className="app-scheduled-tasks-hub-header">
        <div className="app-scheduled-tasks-hub-header-top">
          <div className="app-scheduled-tasks-hub-title-wrap">
            <Typography.Title level={5} className="app-scheduled-tasks-hub-title">
              定时任务
            </Typography.Title>
            {repositoryDisplayName.trim() ? (
              <Typography.Text type="secondary" className="app-scheduled-tasks-hub-repo" ellipsis>
                {repositoryDisplayName.trim()}
              </Typography.Text>
            ) : null}
          </div>
          <Space size={8}>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
              新建
            </Button>
            <Tooltip title="关闭" mouseEnterDelay={0.35}>
              <Button
                type="text"
                size="small"
                className="app-scheduled-tasks-hub-close-btn"
                icon={<CloseOutlined />}
                aria-label="关闭"
                onClick={handleDismiss}
              />
            </Tooltip>
          </Space>
        </div>
        {hint}
      </header>
      <div className="app-scheduled-tasks-hub-main">{tableNode}</div>
    </div>
  ) : (
    <>
      <div className="app-scheduled-tasks-modal__toolbar">
        {hint}
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新建
        </Button>
      </div>
      {tableNode}
    </>
  );

  if (!open) return null;

  return (
    <>
      {presentation === "modal" ? (
        <Modal
          open={open}
          onCancel={handleDismiss}
          footer={null}
          width={Math.min(920, typeof window !== "undefined" ? window.innerWidth - 40 : 920)}
          destroyOnHidden
          className="app-scheduled-tasks-modal"
          title={(
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>定时任务</Typography.Text>
            </Space>
          )}
        >
          {listBody}
        </Modal>
      ) : (
        listBody
      )}

      <Drawer
        title={tasks.some((t) => t.id === editing?.id) ? "编辑定时任务" : "新建定时任务"}
        placement="right"
        size={Math.min(560, typeof window !== "undefined" ? window.innerWidth - 24 : 560)}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        destroyOnHidden={false}
        className="app-scheduled-tasks-drawer"
        extra={(
          <Space>
            <Button size="small" onClick={() => setDrawerOpen(false)}>
              取消
            </Button>
            <Button type="primary" size="small" onClick={() => void handleSaveForm()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Form form={form} layout="vertical" size="small" requiredMark={false}>
          <Form.Item
            className="app-scheduled-tasks-drawer__field"
            name="title"
            label="标题"
            rules={[{ required: true, message: "填写标题" }]}
          >
            <Input placeholder="简短名称" allowClear maxLength={80} />
          </Form.Item>
          <Form.Item
            className="app-scheduled-tasks-drawer__field"
            name="executionKind"
            label="执行方式"
            rules={[{ required: true, message: "请选择执行方式" }]}
          >
            <Select
              options={SCHEDULED_TASK_EXECUTION_KIND_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Form.Item
            className="app-scheduled-tasks-drawer__field"
            name="cronExpression"
            label="执行周期"
            rules={[{ required: true, message: "请配置执行周期" }]}
            extra={(
              <span className="app-scheduled-tasks-modal__mono-muted">
                可视化 Cron（react-js-cron，分/时/日/月/周）；调度与 `cron-parser` 一致。
              </span>
            )}
          >
            <ScheduledTaskCronField key={editing?.id ?? "new"} />
          </Form.Item>
          {watchedExecutionKind === "claude" ? (
            <Form.Item
              className="app-scheduled-tasks-drawer__field"
              name="dispatchTargetKey"
              label="执行目标"
              rules={[{ required: true, message: "请选择执行目标" }]}
              extra={(
                <span className="app-scheduled-tasks-modal__mono-muted">
                  可选主会话、独立员工或团队工作流。已参与团队流程画布的员工请改选对应工作流，勿重复选为员工。
                </span>
              )}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="仓库绑定主会话"
                options={scheduledTaskDispatchSelectOptions}
              />
            </Form.Item>
          ) : null}
          {watchedExecutionKind === "workflow" ? (
            <Form.Item
              className="app-scheduled-tasks-drawer__field"
              name="ccWorkflowId"
              label="CC 工作流"
              rules={[{ required: true, message: "请选择工作流" }]}
              extra={(
                <span className="app-scheduled-tasks-modal__mono-muted">
                  触发时向仓库绑定主会话发送 <code>/工作流名</code>；请确保工作流已在 CC Workflow Studio 中导出 Slash 命令。
                </span>
              )}
            >
              <Select
                showSearch
                allowClear
                loading={ccWorkflowsLoading}
                optionFilterProp="label"
                placeholder={ccWorkflows.length > 0 ? "选择工作流" : "暂无工作流，请先在 CC Workflow Studio 创建"}
                options={ccWorkflows.map((wf) => ({
                  value: wf.id,
                  label: wf.name.trim() || wf.id,
                }))}
              />
            </Form.Item>
          ) : null}
          <Form.Item className="app-scheduled-tasks-drawer__field" name="enabled" label="启用" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          {watchedExecutionKind === "script" ? (
            <Form.Item
              className="app-scheduled-tasks-drawer__field"
              name="contentMarkdown"
              label="脚本内容"
              rules={[{ required: true, message: "请填写脚本" }]}
              extra={(
                <span className="app-scheduled-tasks-modal__mono-muted">
                  在仓库根目录通过 zsh -c 执行；可多行。非零退出码记为失败。
                </span>
              )}
            >
              <Input.TextArea rows={12} className="app-scheduled-tasks-drawer__script" placeholder="#!/usr/bin/env bash&#10;npm run build" />
            </Form.Item>
          ) : watchedExecutionKind === "claude" ? (
            <div className="app-scheduled-tasks-drawer__field">
              <span className="app-scheduled-tasks-drawer__label">执行内容（Markdown）</span>
              <Form.Item name="contentMarkdown" noStyle rules={[{ required: true, message: "请填写执行内容" }]}>
                <MilkdownFormBridge form={form} fieldName="contentMarkdown" instanceKey={editing?.id ?? "new"} />
              </Form.Item>
            </div>
          ) : null}
        </Form>
      </Drawer>
    </>
  );
}

function tableBodyScrollHeight(presentation: ScheduledTasksPresentation): number {
  if (typeof window === "undefined") return presentation === "overlay" ? 480 : 320;
  if (presentation === "overlay") {
    return Math.max(280, window.innerHeight - 240);
  }
  return Math.max(200, Math.min(400, window.innerHeight - 280));
}

interface MilkdownFormBridgeProps {
  form: FormInstance<{
    title: string;
    cronExpression: string;
    executionKind: ScheduledTaskExecutionKind;
    dispatchTargetKey: string;
    ccWorkflowId: string | null;
    enabled: boolean;
    contentMarkdown: string;
  }>;
  fieldName: "contentMarkdown";
  instanceKey: string;
}

function MilkdownFormBridge({ form, fieldName, instanceKey }: MilkdownFormBridgeProps) {
  const value = Form.useWatch(fieldName, form) ?? "";
  return (
    <div className="app-scheduled-tasks-drawer__editor">
      <PromptMilkdownField
        instanceKey={`scheduled-task-${instanceKey}`}
        label=""
        value={value}
        onChange={(md) => form.setFieldValue(fieldName, md)}
      />
    </div>
  );
}
