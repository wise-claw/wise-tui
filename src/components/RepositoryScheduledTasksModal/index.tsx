import { PlusOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import type { FormInstance } from "antd/es/form";
import type { ColumnsType } from "antd/es/table";
import { CronExpressionParser } from "cron-parser";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeItem, RepositoryScheduledClaudeTask, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { collectTeamMemberEmployeeIds } from "../../utils/collectTeamMemberEmployeeIds";
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
    employeeId: string | null;
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

  const watchedEmployeeId = Form.useWatch("employeeId", form);
  const scheduledTaskEmployeeSelectOptions = useMemo(() => {
    const currentIdRaw = typeof watchedEmployeeId === "string" ? watchedEmployeeId.trim() : "";
    const currentId = currentIdRaw || null;
    const base = dispatchableEmployees.filter((e) => !teamMemberEmployeeIds.has(e.id));
    const pinned =
      currentId && teamMemberEmployeeIds.has(currentId) ? employees.find((e) => e.id === currentId) : undefined;
    const pinnedOption = pinned
      ? [
          {
            value: pinned.id,
            label: `${pinned.name}（已在团队流程中，请清空或另选）`,
            disabled: true as const,
          },
        ]
      : [];
    return [...pinnedOption, ...base.map((e) => ({ value: e.id, label: e.name }))];
  }, [dispatchableEmployees, employees, teamMemberEmployeeIds, watchedEmployeeId]);

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
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastScheduledSlotAt: initialLastScheduledSlotForCron("0 9 * * *", now),
    };
    setEditing(draft);
    form.setFieldsValue({
      title: "",
      cronExpression: draft.cronExpression,
      employeeId: null,
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
      employeeId: row.employeeId?.trim() ? row.employeeId : null,
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
      const employeeId = v.employeeId?.trim() ? v.employeeId.trim() : null;
      if (employeeId && teamMemberEmployeeIds.has(employeeId)) {
        message.error("执行员工不能选择已在团队流程中的员工");
        return;
      }
      if (isNew) {
        const nextRow: RepositoryScheduledClaudeTask = {
          ...editing,
          title: v.title.trim() || "未命名任务",
          cronExpression: cron,
          contentMarkdown: v.contentMarkdown,
          employeeId,
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
      width: 148,
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
      width: 138,
      render: (_, row) => (
        <span className="app-scheduled-tasks-modal__mono-muted">{formatNextRunHint(row.cronExpression)}</span>
      ),
    },
    {
      title: "员工",
      key: "emp",
      width: 88,
      render: (_, row) => {
        if (!row.employeeId) return <Tag>主会话</Tag>;
        const n = employees.find((e) => e.id === row.employeeId)?.name ?? "—";
        return <Tag color="blue">{n}</Tag>;
      },
    },
    {
      title: "最近",
      key: "last",
      width: 128,
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
      width: 108,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
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
            按 Cron 在后台触发：向当前仓库绑定主会话发起一次与手动「执行」相同的 Claude Code 调用；可选员工子标签。应用需保持运行；主会话非空闲时本轮跳过。
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
          pagination={false}
          scroll={{ x: 780, y: minTableBodyHeight() }}
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
            name="employeeId"
            label="执行员工"
            extra={(
              <span className="app-scheduled-tasks-modal__mono-muted">
                已参与任意团队流程（阶段指派或画布节点）的员工不可选；请使用主会话或其他员工。
              </span>
            )}
          >
            <Select
              allowClear
              placeholder="主会话（仓库绑定标签）"
              options={scheduledTaskEmployeeSelectOptions}
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
    employeeId: string | null;
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
