import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { Button, Drawer, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED } from "../../constants/workflowUiEvents";
import type { FormInstance } from "antd/es/form";
import type { ColumnsType } from "antd/es/table";
import { CronExpressionParser } from "cron-parser";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepositoryScheduledClaudeTask, WorkflowTemplateItem } from "../../types";
import { PromptRichTextField } from "../PromptRichTextField";
import {
  initialLastScheduledSlotForCron,
  readRepositoryScheduledClaudeTasks,
  writeRepositoryScheduledClaudeTasks,
  patchRepositoryScheduledClaudeTask,
} from "../../services/repositoryScheduledClaudeTasksStore";
import {
  SCHEDULED_TASK_EXECUTION_KIND_OPTIONS,
  formatScheduledTaskExecutionKindLabel,
  resolveScheduledTaskExecutionKind,
  type ScheduledTaskExecutionKind,
} from "../../utils/scheduledTaskExecution";
import {
  formatScheduledTaskDispatchTargetLabel,
  parseScheduledTaskDispatchTargetKey,
  scheduledTaskDispatchTargetKey,
  SCHEDULED_TASK_DISPATCH_NEW_SESSION,
} from "../../utils/scheduledTaskDispatchTarget";
import {
  normalizeScheduledTaskScriptFilePath,
  resolveScheduledTaskScriptSource,
  type ScheduledTaskScriptSource,
} from "../../utils/scheduledTaskScript";
import { ScheduledTaskCronField } from "./ScheduledTaskCronField";
import { ScheduledTaskScriptFileSelect } from "./ScheduledTaskScriptFileSelect";
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
  workflowTemplates?: WorkflowTemplateItem[];
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
  workflowTemplates = [],
  presentation = "overlay",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<RepositoryScheduledClaudeTask[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RepositoryScheduledClaudeTask | null>(null);
  const [form] = Form.useForm<{
    title: string;
    cronExpression: string;
    executionKind: ScheduledTaskExecutionKind;
    dispatchTargetKey: string;
    enabled: boolean;
    scriptSource: ScheduledTaskScriptSource;
    scriptFilePath: string;
    contentMarkdown: string;
  }>();

  const watchedExecutionKind = Form.useWatch("executionKind", form) ?? "claude";
  const watchedScriptSource = Form.useWatch("scriptSource", form) ?? "inline";
  const watchedDispatchTargetKey = Form.useWatch("dispatchTargetKey", form);

  const scheduledTaskDispatchSelectOptions = useMemo(() => {
    const currentKey =
      typeof watchedDispatchTargetKey === "string" && watchedDispatchTargetKey.trim()
        ? watchedDispatchTargetKey.trim()
        : SCHEDULED_TASK_DISPATCH_NEW_SESSION;
    const parsedCurrent = parseScheduledTaskDispatchTargetKey(currentKey);
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
        label: "会话",
        options: [{ value: SCHEDULED_TASK_DISPATCH_NEW_SESSION, label: "新建会话" }],
      },
      {
        label: "团队 / 工作流",
        options: [...pinnedWorkflow, ...workflowOptions],
      },
    ];
  }, [watchedDispatchTargetKey, workflowTemplates]);

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
      executionKind: "claude",
      contentMarkdown: "",
      scriptFilePath: null,
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
      dispatchTargetKey: SCHEDULED_TASK_DISPATCH_NEW_SESSION,
      enabled: true,
      scriptSource: "inline",
      scriptFilePath: "",
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
      enabled: row.enabled,
      scriptSource: resolveScheduledTaskScriptSource(row),
      scriptFilePath: normalizeScheduledTaskScriptFilePath(row.scriptFilePath) ?? "",
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
      let scriptFilePath: string | null = null;
      let contentMarkdown = v.contentMarkdown;
      let workflowId: string | null = null;
      if (executionKind === "claude") {
        if (!md) {
          message.error("请填写 Claude 执行内容");
          return;
        }
        const dispatchParsed = parseScheduledTaskDispatchTargetKey(v.dispatchTargetKey);
        workflowId = dispatchParsed.workflowId;
        if (workflowId && !workflowTemplates.some((wf) => wf.id === workflowId)) {
          message.error("所选团队工作流不存在");
          return;
        }
      } else if (executionKind === "script") {
        const source = v.scriptSource === "file" ? "file" : "inline";
        if (source === "file") {
          const normalized = normalizeScheduledTaskScriptFilePath(v.scriptFilePath);
          if (!normalized) {
            message.error("请选择合法的仓库脚本文件");
            return;
          }
          scriptFilePath = normalized;
          contentMarkdown = "";
        } else if (!md) {
          message.error("请填写脚本内容");
          return;
        }
      }
      const isNew = !tasks.some((t) => t.id === editing.id);
      const slot = initialLastScheduledSlotForCron(cron, now);
      if (isNew) {
        const nextRow: RepositoryScheduledClaudeTask = {
          ...editing,
          title: v.title.trim() || "未命名任务",
          cronExpression: cron,
          executionKind,
          contentMarkdown,
          scriptFilePath: executionKind === "script" ? scriptFilePath : null,
          employeeId: null,
          workflowId: executionKind === "claude" ? workflowId : null,
          ccWorkflowId: null,
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
          contentMarkdown,
          scriptFilePath: executionKind === "script" ? scriptFilePath : null,
          employeeId: null,
          workflowId: executionKind === "claude" ? workflowId : null,
          ccWorkflowId: null,
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
        <HoverHint title={c}>
          <span className="app-scheduled-tasks-modal__cron">{c}</span>
        </HoverHint>
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
          <HoverHint title={hint}>
            <span className="app-scheduled-tasks-modal__mono-muted">{hint}</span>
          </HoverHint>
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
          const filePath = normalizeScheduledTaskScriptFilePath(row.scriptFilePath);
          if (filePath) {
            const base = filePath.split("/").pop() || filePath;
            return (
              <HoverHint title={filePath}>
                <Tag color="cyan">{base}</Tag>
              </HoverHint>
            );
          }
          return <Tag color="green">内联</Tag>;
        }
        const label = formatScheduledTaskDispatchTargetLabel({
          workflowId: row.workflowId,
          workflowName: workflowTemplates.find((wf) => wf.id === row.workflowId)?.name,
        });
        const color = row.workflowId?.trim() ? "purple" : "default";
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
      按 Cron 在后台触发：Claude 可新建会话或派发团队工作流；脚本支持内联命令或仓库文件。应用需保持运行。
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
            <HoverHint title="关闭">
              <Button
                type="text"
                size="small"
                className="app-scheduled-tasks-hub-close-btn"
                icon={<CloseOutlined />}
                aria-label="关闭"
                onClick={handleDismiss}
              />
            </HoverHint>
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
        size={Math.min(600, typeof window !== "undefined" ? window.innerWidth - 24 : 600)}
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
        <Form form={form} layout="vertical" size="small" requiredMark={false} className="app-scheduled-tasks-drawer__form">
          <section className="app-scheduled-tasks-drawer__section">
            <header className="app-scheduled-tasks-drawer__section-head">
              <span className="app-scheduled-tasks-drawer__section-title">基础</span>
              <span className="app-scheduled-tasks-drawer__section-desc">名称、方式与启停</span>
            </header>
            <div className="app-scheduled-tasks-drawer__section-body">
              <div className="app-scheduled-tasks-drawer__title-row">
                <Form.Item
                  className="app-scheduled-tasks-drawer__field app-scheduled-tasks-drawer__field--grow"
                  name="title"
                  label="标题"
                  rules={[{ required: true, message: "填写标题" }]}
                >
                  <Input placeholder="例如：每日巡检" allowClear maxLength={80} />
                </Form.Item>
                <Form.Item
                  className="app-scheduled-tasks-drawer__field app-scheduled-tasks-drawer__field--enabled"
                  name="enabled"
                  label="启用"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </div>
              <Form.Item
                className="app-scheduled-tasks-drawer__field app-scheduled-tasks-drawer__field--kind"
                name="executionKind"
                label="执行方式"
                rules={[{ required: true, message: "请选择执行方式" }]}
              >
                <ScheduledTaskExecutionKindCards
                  onPickScript={() => {
                    if (!form.getFieldValue("scriptSource")) {
                      form.setFieldsValue({ scriptSource: "inline", scriptFilePath: "" });
                    }
                  }}
                />
              </Form.Item>
            </div>
          </section>

          <section className="app-scheduled-tasks-drawer__section">
            <header className="app-scheduled-tasks-drawer__section-head">
              <span className="app-scheduled-tasks-drawer__section-title">调度</span>
              <span className="app-scheduled-tasks-drawer__section-desc">何时触发</span>
            </header>
            <div className="app-scheduled-tasks-drawer__section-body">
              <Form.Item
                className="app-scheduled-tasks-drawer__field"
                name="cronExpression"
                label="执行周期"
                rules={[{ required: true, message: "请配置执行周期" }]}
                extra={<span className="app-scheduled-tasks-drawer__hint">与 cron-parser 一致（分 / 时 / 日 / 月 / 周）</span>}
              >
                <ScheduledTaskCronField key={editing?.id ?? "new"} />
              </Form.Item>
            </div>
          </section>

          <section className="app-scheduled-tasks-drawer__section app-scheduled-tasks-drawer__section--payload">
            <header className="app-scheduled-tasks-drawer__section-head">
              <span className="app-scheduled-tasks-drawer__section-title">执行</span>
              <span className="app-scheduled-tasks-drawer__section-desc">
                {watchedExecutionKind === "script" ? "脚本或仓库文件" : "目标与提示词"}
              </span>
            </header>
            <div className="app-scheduled-tasks-drawer__section-body">
              {watchedExecutionKind === "claude" ? (
                <Form.Item
                  className="app-scheduled-tasks-drawer__field"
                  name="dispatchTargetKey"
                  label="执行目标"
                  rules={[{ required: true, message: "请选择执行目标" }]}
                  extra={<span className="app-scheduled-tasks-drawer__hint">默认新建会话；也可派发到团队工作流</span>}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="新建会话"
                    options={scheduledTaskDispatchSelectOptions}
                  />
                </Form.Item>
              ) : null}

              {watchedExecutionKind === "script" ? (
                <>
                  <Form.Item
                    className="app-scheduled-tasks-drawer__field"
                    name="scriptSource"
                    label="脚本来源"
                    rules={[{ required: true, message: "请选择脚本来源" }]}
                  >
                    <Segmented
                      block
                      className="app-scheduled-tasks-drawer__segmented"
                      options={[
                        { label: "内联脚本", value: "inline" },
                        { label: "仓库文件", value: "file" },
                      ]}
                    />
                  </Form.Item>
                  {watchedScriptSource === "file" ? (
                    <Form.Item
                      className="app-scheduled-tasks-drawer__field"
                      name="scriptFilePath"
                      label="执行文件"
                      rules={[{ required: true, message: "请选择执行文件" }]}
                      extra={<span className="app-scheduled-tasks-drawer__hint">从仓库目录树选择文件，触发时用 zsh 执行</span>}
                    >
                      <ScheduledTaskScriptFileSelect repositoryPath={repositoryPath} />
                    </Form.Item>
                  ) : (
                    <Form.Item
                      className="app-scheduled-tasks-drawer__field app-scheduled-tasks-drawer__field--last"
                      name="contentMarkdown"
                      label="脚本内容"
                      rules={[{ required: true, message: "请填写脚本" }]}
                      extra={<span className="app-scheduled-tasks-drawer__hint">在仓库根目录通过 zsh -c 执行</span>}
                    >
                      <Input.TextArea
                        rows={14}
                        className="app-scheduled-tasks-drawer__script"
                        placeholder={"#!/usr/bin/env bash\nnpm run build"}
                      />
                    </Form.Item>
                  )}
                </>
              ) : watchedExecutionKind === "claude" ? (
                <div className="app-scheduled-tasks-drawer__field app-scheduled-tasks-drawer__field--last">
                  <span className="app-scheduled-tasks-drawer__label">执行内容</span>
                  <Form.Item name="contentMarkdown" noStyle rules={[{ required: true, message: "请填写执行内容" }]}>
                    <RichTextFormBridge form={form} fieldName="contentMarkdown" instanceKey={editing?.id ?? "new"} />
                  </Form.Item>
                </div>
              ) : null}
            </div>
          </section>
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

function ScheduledTaskExecutionKindCards({
  value,
  onChange,
  onPickScript,
}: {
  value?: ScheduledTaskExecutionKind;
  onChange?: (next: ScheduledTaskExecutionKind) => void;
  onPickScript?: () => void;
}) {
  const selected = value === "script" || value === "claude" ? value : "claude";
  return (
    <div className="app-scheduled-tasks-drawer__kind-grid" role="radiogroup" aria-label="执行方式">
      {SCHEDULED_TASK_EXECUTION_KIND_OPTIONS.map((item) => {
        const active = selected === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`app-scheduled-tasks-drawer__kind-card${active ? " is-selected" : ""}`}
            onClick={() => {
              onChange?.(item.value);
              if (item.value === "script") onPickScript?.();
            }}
          >
            <span className="app-scheduled-tasks-drawer__kind-card-title">{item.label}</span>
            <span className="app-scheduled-tasks-drawer__kind-card-desc">{item.description}</span>
          </button>
        );
      })}
    </div>
  );
}

interface RichTextFormBridgeProps {
  form: FormInstance<{
    title: string;
    cronExpression: string;
    executionKind: ScheduledTaskExecutionKind;
    dispatchTargetKey: string;
    enabled: boolean;
    scriptSource: ScheduledTaskScriptSource;
    scriptFilePath: string;
    contentMarkdown: string;
  }>;
  fieldName: "contentMarkdown";
  instanceKey: string;
}

function RichTextFormBridge({ form, fieldName, instanceKey }: RichTextFormBridgeProps) {
  const value = Form.useWatch(fieldName, form) ?? "";
  return (
    <div className="app-scheduled-tasks-drawer__editor">
      <PromptRichTextField
        instanceKey={`scheduled-task-${instanceKey}`}
        label=""
        value={value}
        onChange={(md) => form.setFieldValue(fieldName, md)}
      />
    </div>
  );
}
