import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App, Button, Drawer, Empty, Form, Input, Modal, Select, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listAgents } from "../../services/agentRegistry";
import {
  deleteCustomAssistant,
  listAssistants,
  saveCustomAssistant,
} from "../../services/assistants";
import type { DetectedAgent } from "../../types/detectedAgent";
import type { AssistantEntry, CustomAssistantInput } from "../../types/assistant";
import {
  AuthorPanelEmptyShell,
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelListShell,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import { HubDot, HubItem, HubItems, HubTag, avatarColorFor } from "../HubCard";
import {
  buildAgentEngineIndex,
  resolveAssistantEngineBinding,
} from "./engineBinding";

interface FormValues {
  id?: string;
  name: string;
  description?: string;
  engineId: string;
  systemPrompt?: string;
  model?: string;
}

type Filter = "all" | "custom" | "extension" | "builtin";

export function AssistantsPanel() {
  const { message } = App.useApp();
  const [list, setList] = useState<AssistantEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<{ open: boolean; row?: AssistantEntry }>({ open: false });
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

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

  const filtered = useMemo(() => {
    if (filter === "all") return list;
    return list.filter((a) => a.source === filter);
  }, [list, filter]);

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
    const builtins = ["claude", "codex", "gemini"];
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

  return (
    <>
      <AuthorPanelPageShell
        className="app-assistants-panel"
        id="assistants"
        icon={<UserOutlined />}
        title="助手模板"
        subtitle="角色模板、模型和系统提示词"
        actions={
          <>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void fetchAll()}>
              同步模板
            </Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增模板
            </Button>
          </>
        }
        toolbar={
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
        }
      >
        {loading && list.length === 0 ? (
          <div className="author-panel-page__loading">
            <Spin size="small" />
          </div>
        ) : filtered.length === 0 ? (
          <AuthorPanelEmptyShell>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此类别暂无助手" />
          </AuthorPanelEmptyShell>
        ) : (
          <AuthorPanelListShell>
          <HubItems>
            {filtered.map((a) => {
              const tone =
                a.source === "extension" ? "purple" : a.source === "builtin" ? "default" : "primary";
              const sourceLabel =
                a.source === "extension"
                  ? `来自扩展 ${a.extensionId ?? "ext"}`
                  : a.source === "builtin"
                    ? "内置"
                    : "自定义";
              const engineStatus = resolveAssistantEngineBinding(a, agentEngineIndex);
              return (
                <HubItem
                  key={a.id}
                  avatarText={a.name || "·"}
                  avatarColor={a.avatarColor ?? avatarColorFor(a.name)}
                  title={a.name}
                  tags={
                    <>
                      <HubTag tone={tone}>{sourceLabel}</HubTag>
                      <HubTag mono>{a.engineId}</HubTag>
                      {a.model ? <HubTag mono>{a.model}</HubTag> : null}
                      <HubTag tone={engineStatus.tone}>
                        <HubDot tone={engineStatus.dotTone} />
                        {engineStatus.label}
                      </HubTag>
                    </>
                  }
                  author={`执行入口：${engineStatus.detail}`}
                  description={a.description || (a.systemPrompt ?? "—").slice(0, 120)}
                  actions={
                    a.source === "custom" ? (
                      <>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => openEdit(a)}
                          aria-label="编辑"
                        />
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(a)}
                          aria-label="删除"
                        />
                      </>
                    ) : null
                  }
                />
              );
            })}
          </HubItems>
          </AuthorPanelListShell>
        )}
      </AuthorPanelPageShell>

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
            label="执行引擎"
            rules={[{ required: true, message: "需要选择引擎" }]}
            help="引用一个已检测执行引擎的后端标识。未检测到的引擎也可以保存，使用前会提示。"
          >
            <Select options={engineOptions} placeholder="选择 Claude / Codex / Gemini / 自定义引擎" />
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
