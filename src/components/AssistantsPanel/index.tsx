import { PlusOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Form, Input, Modal, Select } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantHubBody } from "../AssistantHubShared/AssistantHubBody";
import type { AssistantHubFilter } from "../AssistantHubShared/groupAssistants";
import { AssistantSettingsDrawer } from "../CockpitSurface/AssistantSettingsDrawer";
import { resolveAssistantKind } from "../CockpitSurface/assistantKind";
import { listAgents } from "../../services/agentRegistry";
import {
  deleteCustomAssistant,
  listAssistants,
  saveCustomAssistant,
} from "../../services/assistants";
import type { DetectedAgent } from "../../types/detectedAgent";
import type { AssistantEntry, CustomAssistantInput } from "../../types/assistant";
import {
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import {
  buildAgentEngineIndex,
  resolveAssistantEngineBinding,
} from "./engineBinding";
import "../CockpitSurface/index.css";
import "./AssistantsPanel.css";

interface FormValues {
  id?: string;
  name: string;
  description?: string;
  engineId: string;
  systemPrompt?: string;
  model?: string;
}

export interface AssistantsPanelProps {
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  /** 在 Cockpit 中打开该助手（与助手 Hub「打开」一致） */
  onOpenAssistant?: (assistantId: string) => void;
}

export function AssistantsPanel({
  activeProjectId = null,
  activeProjectName = null,
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

  const settingsAssistant = useMemo(
    () => list.find((a) => a.id === settingsAssistantId) ?? null,
    [list, settingsAssistantId],
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

  const openCreate = useCallback(() => {
    setEditor({ open: true });
    form.setFieldsValue({
      id: undefined,
      name: "",
      description: "",
      engineId: "claude",
      systemPrompt: "",
      model: undefined,
    });
  }, [form]);

  const openEdit = useCallback(
    (row: AssistantEntry) => {
      if (row.source !== "custom" || !row.customId) return;
      setEditor({ open: true, row });
      form.setFieldsValue({
        id: row.customId,
        name: row.name,
        description: row.description,
        engineId: row.engineId,
        systemPrompt: row.systemPrompt ?? "",
        model: row.model ?? undefined,
      });
    },
    [form],
  );

  const closeDrawer = useCallback(() => {
    setEditor({ open: false });
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const input: CustomAssistantInput = {
        id: v.id,
        name: v.name.trim(),
        description: (v.description ?? "").trim(),
        engineId: v.engineId.trim(),
        systemPrompt: (v.systemPrompt ?? "").trim(),
        model: v.model?.trim() ? v.model.trim() : null,
      };
      await saveCustomAssistant(input);
      message.success("已保存");
      await fetchAll();
      closeDrawer();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [form, message, fetchAll, closeDrawer]);

  const handleDelete = useCallback(
    (row: AssistantEntry) => {
      if (row.source !== "custom" || !row.customId) return;
      Modal.confirm({
        title: `删除助手「${row.name}」？`,
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await deleteCustomAssistant(row.customId!);
            message.success("已删除");
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
            resolveAssistantEngineBinding(assistant, agentEngineIndex)
          }
          renderCardActions={(assistant) => {
            const needsProject =
              resolveAssistantKind(assistant) === "trellis-orchestration" && !activeProjectId;
            const actions = {
              disabled: needsProject,
              disabledHint: needsProject ? "请先在左栏选择工作区后再打开编排助手" : undefined,
              onSelect: onOpenAssistant
                ? () => onOpenAssistant(assistant.id)
                : undefined,
              onOpenSettings: () => setSettingsAssistantId(assistant.id),
            };
            if (assistant.source === "custom") {
              return {
                ...actions,
                onEdit: () => openEdit(assistant),
                onDelete: () => handleDelete(assistant),
              };
            }
            return actions;
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
        </Form>
      </Drawer>
    </>
  );
}
