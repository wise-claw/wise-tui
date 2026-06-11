import { PlusOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Form, Input, Modal, Select, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantHubBody } from "../AssistantHubShared/AssistantHubBody";
import type { AssistantHubFilter } from "../AssistantHubShared/groupAssistants";
import { AssistantSettingsDrawer } from "../CockpitSurface/AssistantSettingsDrawer";
import { resolveAssistantKind } from "../CockpitSurface/assistantKind";
import { listAgents } from "../../services/agentRegistry";
import {
  deleteAssistant,
  listAssistants,
  saveCustomAssistant,
} from "../../services/assistants";
import type { DetectedAgent } from "../../types/detectedAgent";
import type { AssistantEntry, AssistantEntryKind, CustomAssistantInput } from "../../types/assistant";
import type { WorkflowTemplateItem } from "../../types";
import {
  ASSISTANT_ENTRY_KIND_OPTIONS,
  isAssistantConversationEntry,
  resolveAssistantEntryKind,
} from "../../utils/assistantTemplateEntry";
import {
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import {
  buildAssistantRuntimeBundleJson,
  parseAssistantRuntimeBundle,
  resolveAssistantRuntime,
  saveAssistantRuntimeOverrides,
  type AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import {
  buildAgentEngineIndex,
  resolveAssistantEngineBinding,
} from "./engineBinding";
import { AssistantTemplateBundleFields } from "./AssistantTemplateBundleFields";
import "../CockpitSurface/index.css";
import "./AssistantsPanel.css";

const EMPTY_RUNTIME_BUNDLE: AssistantRuntimeBundle = { disabled: [], custom: [] };

interface FormValues {
  id?: string;
  name: string;
  description?: string;
  entryKind: AssistantEntryKind;
  engineId: string;
  systemPrompt?: string;
  model?: string;
  entryUrl?: string;
  entryWorkflowId?: string;
  entryScript?: string;
}

export interface AssistantsPanelProps {
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  activeRepositoryPath?: string | null;
  workflowTemplates?: WorkflowTemplateItem[];
  /** 激活助手模板（对话 / 链接 / 工作流 / 脚本） */
  onActivateAssistant?: (assistant: AssistantEntry) => void | Promise<void>;
  /** @deprecated 使用 onActivateAssistant */
  onOpenAssistant?: (assistantId: string) => void;
}

export function AssistantsPanel({
  activeProjectId = null,
  activeProjectName = null,
  activeRepositoryPath = null,
  workflowTemplates = [],
  onActivateAssistant,
  onOpenAssistant,
}: AssistantsPanelProps = {}) {
  const { message } = App.useApp();
  const [list, setList] = useState<AssistantEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [filter, setFilter] = useState<AssistantHubFilter>("all");
  const [editor, setEditor] = useState<{ open: boolean; row?: AssistantEntry }>({ open: false });
  const [settingsAssistantId, setSettingsAssistantId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [skillBundle, setSkillBundle] = useState<AssistantRuntimeBundle>(EMPTY_RUNTIME_BUNDLE);
  const [mcpBundle, setMcpBundle] = useState<AssistantRuntimeBundle>(EMPTY_RUNTIME_BUNDLE);
  const [bundleLoading, setBundleLoading] = useState(false);
  const watchedEntryKind = Form.useWatch("entryKind", form) ?? "conversation";

  const settingsAssistant = useMemo(
    () => list.find((a) => a.id === settingsAssistantId) ?? null,
    [list, settingsAssistantId],
  );

  const workflowOptions = useMemo(
    () =>
      workflowTemplates.map((workflow) => ({
        value: workflow.id,
        label: workflow.name.trim() || workflow.id,
      })),
    [workflowTemplates],
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [a, eng] = await Promise.all([listAssistants(), listAgents().catch(() => [])]);
      setList(a);
      setAgents(eng);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const counts = useMemo(
    () => ({
      total: list.length,
      builtin: list.filter((a) => a.source === "builtin").length,
      custom: list.filter((a) => a.source === "custom").length,
      extension: list.filter((a) => a.source === "extension").length,
    }),
    [list],
  );

  const agentEngineIndex = useMemo(() => buildAgentEngineIndex(agents), [agents]);

  const loadTemplateBundles = useCallback(async (assistantId: string) => {
    setBundleLoading(true);
    try {
      const runtime = await resolveAssistantRuntime({ assistantId });
      setSkillBundle(parseAssistantRuntimeBundle(runtime.skillBundleJson));
      setMcpBundle(parseAssistantRuntimeBundle(runtime.mcpBundleJson));
    } catch (e) {
      setSkillBundle(EMPTY_RUNTIME_BUNDLE);
      setMcpBundle(EMPTY_RUNTIME_BUNDLE);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBundleLoading(false);
    }
  }, [message]);

  const openCreate = useCallback(() => {
    setEditor({ open: true });
    setSkillBundle(EMPTY_RUNTIME_BUNDLE);
    setMcpBundle(EMPTY_RUNTIME_BUNDLE);
    form.setFieldsValue({
      id: undefined,
      name: "",
      description: "",
      entryKind: "conversation",
      engineId: "claude",
      systemPrompt: "",
      model: undefined,
      entryUrl: "",
      entryWorkflowId: undefined,
      entryScript: "",
    });
  }, [form]);

  const openEdit = useCallback(
    (row: AssistantEntry) => {
      if (row.source !== "custom" || !row.customId) return;
      setEditor({ open: true, row });
      void loadTemplateBundles(row.id);
      form.setFieldsValue({
        id: row.customId,
        name: row.name,
        description: row.description,
        entryKind: resolveAssistantEntryKind(row),
        engineId: row.engineId,
        systemPrompt: row.systemPrompt ?? "",
        model: row.model ?? undefined,
        entryUrl: row.entryUrl ?? "",
        entryWorkflowId: row.entryWorkflowId ?? undefined,
        entryScript: row.entryScript ?? "",
      });
    },
    [form, loadTemplateBundles],
  );

  const closeDrawer = useCallback(() => {
    setEditor({ open: false });
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const v = await form.validateFields();
      const entryKind = v.entryKind ?? "conversation";
      setSaving(true);
      const input: CustomAssistantInput = {
        id: v.id,
        name: v.name.trim(),
        description: (v.description ?? "").trim(),
        engineId: entryKind === "conversation" ? v.engineId.trim() : "claude",
        systemPrompt: (v.systemPrompt ?? "").trim(),
        model: v.model?.trim() ? v.model.trim() : null,
        entryKind,
        entryUrl: (v.entryUrl ?? "").trim(),
        entryWorkflowId: v.entryWorkflowId?.trim() ? v.entryWorkflowId.trim() : null,
        entryScript: (v.entryScript ?? "").trim(),
      };
      const saved = await saveCustomAssistant(input);
      if (entryKind === "conversation") {
        await saveAssistantRuntimeOverrides({
          assistantId: saved.id,
          scope: "assistant",
          patch: {
            skillBundleJson: buildAssistantRuntimeBundleJson(skillBundle),
            mcpBundleJson: buildAssistantRuntimeBundleJson(mcpBundle),
          },
        });
      }
      await fetchAll();
      closeDrawer();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [form, message, fetchAll, closeDrawer, skillBundle, mcpBundle]);

  const handleDelete = useCallback(
    (row: AssistantEntry) => {
      const deleteHint =
        row.source === "custom"
          ? "将永久删除该自定义模板及其助手级覆盖配置。"
          : row.source === "builtin"
            ? "将从助手列表与快捷操作中移除该内置模板。"
            : "将从助手列表与快捷操作中移除该扩展模板。";
      Modal.confirm({
        title: `删除助手「${row.name}」？`,
        content: deleteHint,
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await deleteAssistant(row.id);
            await fetchAll();
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        },
      });
    },
    [message, fetchAll],
  );

  const handleActivate = useCallback(
    (assistant: AssistantEntry) => {
      if (onActivateAssistant) {
        void onActivateAssistant(assistant);
        return;
      }
      if (onOpenAssistant) {
        onOpenAssistant(assistant.id);
      }
    },
    [onActivateAssistant, onOpenAssistant],
  );

  const engineOptions = useMemo(() => {
    const builtins = ["claude", "codex", "gemini", "opencode", "cursor"];
    const customAgents = agents.filter((a) => a.kind === "custom");
    const opts = builtins.map((id) => {
      const detectedHit = agentEngineIndex.get(id);
      return {
        value: id,
        label: detectedHit ? `${id} · ${detectedHit.available ? "可用" : "不可用"}` : `${id} · 未检测到`,
      };
    });
    for (const c of customAgents) {
      opts.push({ value: c.backend, label: `${c.name} · 自定义 · ${c.available ? "可用" : "不可用"}` });
    }
    return opts;
  }, [agentEngineIndex, agents]);

  const filterTabs = (
    <AuthorPanelHubTabs aria-label="助手筛选">
      <AuthorPanelHubTab
        active={filter === "all"}
        label="全部"
        count={counts.total}
        onClick={() => setFilter("all")}
      />
      <AuthorPanelHubTab
        active={filter === "builtin"}
        label="内置"
        count={counts.builtin}
        onClick={() => setFilter("builtin")}
      />
      <AuthorPanelHubTab
        active={filter === "custom"}
        label="自定义"
        count={counts.custom}
        onClick={() => setFilter("custom")}
      />
      <AuthorPanelHubTab
        active={filter === "extension"}
        label="扩展贡献"
        count={counts.extension}
        onClick={() => setFilter("extension")}
      />
    </AuthorPanelHubTabs>
  );

  return (
    <>
      <AuthorPanelPageShell
        className="app-assistants-panel author-panel-page--hub-body"
        id="assistants"
        icon={<UserOutlined />}
        title="助手模板"
        subtitle="任务入口、系统提示词与 Claude Code 编排预设"
        actions={
          <>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchAll()}>
              同步模板
            </Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增模板
            </Button>
          </>
        }
        toolbar={filterTabs}
        toolbarLayout="stacked"
      >
        <AssistantHubBody
          assistants={list}
          filter={filter}
          loading={loading}
          mode="manage"
          emptyDescription={
            filter === "custom"
              ? "暂无自定义模板，可点击「新增模板」创建"
              : filter === "extension"
                ? "暂无扩展贡献的助手，请在扩展市场中安装并启用扩展"
                : "此类别暂无助手"
          }
          resolveEngineStatus={(assistant) =>
            isAssistantConversationEntry(assistant)
              ? resolveAssistantEngineBinding(assistant, agentEngineIndex)
              : undefined
          }
          renderCardActions={(assistant) => {
            const entryKind = resolveAssistantEntryKind(assistant);
            const needsProject =
              entryKind === "conversation" &&
              resolveAssistantKind(assistant) === "trellis-orchestration" &&
              !activeProjectId;
            const needsRepository =
              (entryKind === "run_workflow" || entryKind === "run_script") &&
              !activeRepositoryPath?.trim();
            const disabled = needsProject || needsRepository;
            const disabledHint = needsProject
              ? "请先在左栏选择工作区后再打开编排助手"
              : needsRepository
                ? "请先在左栏选择仓库后再执行"
                : undefined;
            return {
              disabled,
              disabledHint,
              onSelect: onActivateAssistant || onOpenAssistant ? () => handleActivate(assistant) : undefined,
              onOpenSettings: () => setSettingsAssistantId(assistant.id),
              onEdit: assistant.source === "custom" ? () => openEdit(assistant) : undefined,
              onDelete: () => handleDelete(assistant),
            };
          }}
        />
      </AuthorPanelPageShell>

      <AssistantSettingsDrawer
        open={settingsAssistantId !== null}
        assistant={settingsAssistant}
        activeProjectId={activeProjectId}
        activeProjectName={activeProjectName}
        onClose={() => setSettingsAssistantId(null)}
      />

      <Drawer
        title={editor.row ? `编辑模板 · ${editor.row.name}` : "新增模板"}
        open={editor.open}
        onClose={closeDrawer}
        size="large"
        destroyOnClose
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button size="small" onClick={closeDrawer}>
              取消
            </Button>
            <Button size="small" type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" requiredMark="optional" size="small">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: "需要填写模板名称" }]}>
            <Input placeholder="例如：代码审查助手" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="一句话说明这个助手适合做什么" />
          </Form.Item>
          <Form.Item
            name="entryKind"
            label="入口类型"
            rules={[{ required: true, message: "需要选择入口类型" }]}
          >
            <Select
              options={ASSISTANT_ENTRY_KIND_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          {watchedEntryKind === "conversation" ? (
            <>
              <Form.Item
                name="engineId"
                label="运行环境"
                rules={[{ required: true, message: "需要选择运行环境" }]}
                help="当前主运行环境是 Claude Code；其它入口作为未来连接器预留，使用前会提示。"
              >
                <Select options={engineOptions} placeholder="优先选择 Claude Code" />
              </Form.Item>
              <Form.Item name="model" label="模型（可选）">
                <Input placeholder="例如 claude-sonnet-4-6" />
              </Form.Item>
              <Form.Item
                name="systemPrompt"
                label="系统提示词"
                help="开始对话时注入的系统消息，可使用 Markdown。"
              >
                <Input.TextArea rows={8} placeholder="你是一个负责代码审查的工程助手…" />
              </Form.Item>
              {bundleLoading ? (
                <div className="assistant-template-bundle-fields">
                  <Typography.Text type="secondary">读取 Skill / MCP 配置…</Typography.Text>
                </div>
              ) : (
                <AssistantTemplateBundleFields
                  skillBundle={skillBundle}
                  mcpBundle={mcpBundle}
                  onSkillBundleChange={setSkillBundle}
                  onMcpBundleChange={setMcpBundle}
                />
              )}
            </>
          ) : null}
          {watchedEntryKind === "open_link" ? (
            <Form.Item
              name="entryUrl"
              label="链接地址"
              rules={[
                { required: true, message: "需要填写链接地址" },
                {
                  validator: async (_, value: string | undefined) => {
                    const trimmed = (value ?? "").trim();
                    if (!trimmed) return;
                    if (!/^https?:\/\//i.test(trimmed)) {
                      throw new Error("链接需以 http:// 或 https:// 开头");
                    }
                  },
                },
              ]}
            >
              <Input placeholder="https://example.com/docs" />
            </Form.Item>
          ) : null}
          {watchedEntryKind === "run_workflow" ? (
            <>
              <Form.Item
                name="entryWorkflowId"
                label="团队工作流"
                rules={[{ required: true, message: "需要选择工作流" }]}
              >
                <Select
                  options={workflowOptions}
                  placeholder={workflowOptions.length > 0 ? "选择要执行的工作流" : "请先在「工作流」中创建工作流"}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item
                name="systemPrompt"
                label="执行提示词（可选）"
                help="分发到工作流时发送的 Markdown 提示；留空则使用默认文案。"
              >
                <Input.TextArea rows={6} placeholder="请按该工作流完成本轮任务…" />
              </Form.Item>
            </>
          ) : null}
          {watchedEntryKind === "run_script" ? (
            <Form.Item
              name="entryScript"
              label="脚本内容"
              rules={[{ required: true, message: "需要填写脚本内容" }]}
              help="在仓库根目录通过 zsh -c 执行；执行前请先在左栏选择目标仓库。"
            >
              <Input.TextArea rows={8} placeholder={"bun test\n# 或多行 Shell 脚本"} />
            </Form.Item>
          ) : null}
        </Form>
      </Drawer>
    </>
  );
}
