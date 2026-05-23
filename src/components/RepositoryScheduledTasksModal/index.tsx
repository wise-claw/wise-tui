import { PlusOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
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
import { ScheduledTaskCronField } from "./ScheduledTaskCronField";
import "./index.css";

interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath: string;
  repositoryDisplayName: string;
  employees: EmployeeItem[];
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
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
  employees,
  workflowTemplates = [],
  workflowGraphsByWorkflowId = {},
}: Props) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<RepositoryScheduledClaudeTask[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RepositoryScheduledClaudeTask | null>(null);
  const [form] = Form.useForm<{
    title: string;
    cronExpression: string;
    dispatchTargetKey: string;
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
      setDrawerOpen(false);
      setEditing(null);
    }
  }, [open, reload]);

  const openCreate = () => {
    const now = Date.now();
    const draft: RepositoryScheduledClaudeTask = {
      id: newTaskId(),
      title: "",
      cronExpression: "0 9 * * *",
      contentMarkdown: "",
      employeeId: null,
      workflowId: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastScheduledSlotAt: initialLastScheduledSlotForCron("0 9 * * *", now),
    };
    setEditing(draft);
    form.setFieldsValue({
      title: "",
      cronExpression: draft.cronExpression,
      dispatchTargetKey: SCHEDULED_TASK_DISPATCH_MAIN,
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
      dispatchTargetKey: scheduledTaskDispatchTargetKey(row),
      enabled: row.enabled,
      contentMarkdown: row.contentMarkdown,
    });
    setDrawerOpen(true);
  };

  const persistAll = async (next: RepositoryScheduledClaudeTask[]) => {
    await writeRepositoryScheduledClaudeTasks(repositoryPath.trim(), next);
    setTasks(next);
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
      const md = v.contentMarkdown.trim();
      if (!md) {
        message.error("请填写执行内容");
        return;
      }
      const isNew = !tasks.some((t) => t.id === editing.id);
      const slot = initialLastScheduledSlotForCron(cron, now);
      const dispatchParsed = parseScheduledTaskDispatchTargetKey(v.dispatchTargetKey);
      const employeeId = dispatchParsed.employeeId;
      const workflowId = dispatchParsed.workflowId;
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
          contentMarkdown: v.contentMarkdown,
          employeeId,
          workflowId,
          enabled: v.enabled,
          createdAt: now,
          updatedAt: now,
          lastScheduledSlotAt: slot ?? editing.lastScheduledSlotAt,
        };
        const next = [...tasks, nextRow];
        await persistAll(next);
        message.success("已创建");
      } else {
        const prev = tasks.find((t) => t.id === editing.id);
        if (!prev) return;
        const resetSlot = v.enabled && (!prev.enabled || prev.cronExpression.trim() !== cron);
        const merged: RepositoryScheduledClaudeTask = {
          ...prev,
          title: v.title.trim() || "未命名任务",
          cronExpression: cron,
          contentMarkdown: v.contentMarkdown,
          employeeId,
          workflowId,
          enabled: v.enabled,
          updatedAt: now,
          lastScheduledSlotAt: resetSlot ? slot ?? prev.lastScheduledSlotAt : prev.lastScheduledSlotAt,
        };
        const next = tasks.map((t) => (t.id === merged.id ? merged : t));
        await persistAll(next);
        message.success("已保存");
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
    message.success("已删除");
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

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
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
        <div className="app-scheduled-tasks-modal__toolbar">
          <Typography.Paragraph className="app-scheduled-tasks-modal__hint" style={{ marginBottom: 0 }}>
            按 Cron 在后台触发：向当前 Repo 绑定的执行会话发起一次与手动「执行」相同的 Claude Code 调用；可指定主会话、员工子标签或团队工作流。应用需保持运行；执行会话非空闲时本轮跳过。
          </Typography.Paragraph>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
            新建
          </Button>
        </div>
        <Table<RepositoryScheduledClaudeTask>
          size="small"
          rowKey="id"
          loading={loading}
          className="app-scheduled-tasks-modal__table"
          tableLayout="fixed"
          pagination={false}
          scroll={{ y: minTableBodyHeight() }}
          columns={columns}
          dataSource={tasks}
          locale={{ emptyText: "暂无定时任务" }}
        />
      </Modal>

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
          <Form.Item className="app-scheduled-tasks-drawer__field" name="enabled" label="启用" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <div className="app-scheduled-tasks-drawer__field">
            <span className="app-scheduled-tasks-drawer__label">执行内容（Markdown）</span>
            <Form.Item name="contentMarkdown" noStyle>
              <MilkdownFormBridge form={form} fieldName="contentMarkdown" instanceKey={editing?.id ?? "new"} />
            </Form.Item>
          </div>
        </Form>
      </Drawer>
    </>
  );
}

function minTableBodyHeight(): number {
  if (typeof window === "undefined") return 320;
  return Math.max(200, Math.min(400, window.innerHeight - 280));
}

interface MilkdownFormBridgeProps {
  form: FormInstance<{
    title: string;
    cronExpression: string;
    dispatchTargetKey: string;
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
