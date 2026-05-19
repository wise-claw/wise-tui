import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, Modal, Popconfirm, Space, Tag, Tooltip, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCustomAgent,
  listAgents,
  refreshAgents,
  saveCustomAgent,
  testCustomAgent,
} from "../../services/agentRegistry";
import { isAgentKind, type CustomAgentInput, type DetectedAgent, type ProbeResult } from "../../types/detectedAgent";
import {
  deriveAgentRegistryStats,
  describeAgentRuntime,
  filterAgents,
  formatDetectedAt,
  getAgentKindLabel,
  getAgentPathLabel,
  getEmptyDescription,
  type AgentRegistryFilter,
} from "./agentRegistryPresentation";
import {
  AuthorPanelEmptyShell,
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelListShell,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import "./index.css";

interface CustomAgentFormValues {
  id?: string;
  name: string;
  command: string;
  argsText: string;
  envText: string;
}

export function AgentRegistrySection() {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentRegistryFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<DetectedAgent<"custom"> | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [testingAgent, setTestingAgent] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null);
  const [draftFingerprint, setDraftFingerprint] = useState("");
  const [form] = Form.useForm<CustomAgentFormValues>();
  const aliveRef = useRef(true);

  const reload = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = force ? await refreshAgents(true) : await listAgents();
      if (!aliveRef.current) return;
      setAgents(next);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void reload(false);
    return () => {
      aliveRef.current = false;
    };
  }, [reload]);

  const openCreateModal = useCallback(() => {
    setEditingAgent(null);
    setTestResult(null);
    setTestedFingerprint(null);
    const values: CustomAgentFormValues = { name: "", command: "", argsText: "", envText: "" };
    form.setFieldsValue(values);
    setDraftFingerprint(fingerprintFormValues(values));
    setModalOpen(true);
  }, [form]);

  const openEditModal = useCallback(
    (agent: DetectedAgent<"custom">) => {
      setEditingAgent(agent);
      setTestResult(null);
      setTestedFingerprint(null);
      const values: CustomAgentFormValues = {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        argsText: agent.args.join("\n"),
        envText: Object.entries(agent.env)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      };
      form.setFieldsValue(values);
      setDraftFingerprint(fingerprintFormValues(values));
      setModalOpen(true);
    },
    [form],
  );

  const handleValuesChange = useCallback(() => {
    const values = form.getFieldsValue();
    setDraftFingerprint(fingerprintFormValues(values));
    setTestResult(null);
    setTestedFingerprint(null);
  }, [form]);

  const handleTest = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const input = customAgentInputFromForm(values, editingAgent?.id);
      const fingerprint = fingerprintFormValues(values);
      setTestingAgent(true);
      const result = await testCustomAgent(input);
      setTestResult(result);
      setTestedFingerprint(result.ok ? fingerprint : null);
      if (result.ok) {
        message.success("执行命令已探测通过");
      } else {
        message.error(result.error ?? "执行命令探测失败");
      }
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      if (aliveRef.current) setTestingAgent(false);
    }
  }, [editingAgent?.id, form]);

  const handleSave = useCallback(async () => {
    if (!testResult?.ok || testedFingerprint !== draftFingerprint) {
      message.warning("保存前请先探测当前命令");
      return;
    }
    try {
      const values = await form.validateFields();
      const input = customAgentInputFromForm(values, editingAgent?.id);
      setSavingAgent(true);
      await saveCustomAgent(input);
      if (!aliveRef.current) return;
      setModalOpen(false);
      setTestResult(null);
      setTestedFingerprint(null);
      message.success("自定义执行引擎已保存");
      await reload(true);
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      if (aliveRef.current) setSavingAgent(false);
    }
  }, [draftFingerprint, editingAgent?.id, form, reload, testResult?.ok, testedFingerprint]);

  const handleDelete = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        await deleteCustomAgent(id);
        if (!aliveRef.current) return;
        message.success("自定义执行引擎已删除");
        await reload(true);
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    },
    [reload],
  );

  const canSave = Boolean(testResult?.ok && testedFingerprint === draftFingerprint && draftFingerprint);
  const stats = useMemo(() => deriveAgentRegistryStats(agents), [agents]);
  const filteredAgents = useMemo(() => filterAgents(agents, filter, query), [agents, filter, query]);

  return (
    <AuthorPanelPageShell
      className="app-agent-registry-section"
      icon={<ThunderboltOutlined />}
      title="执行引擎"
      subtitle="Claude、Codex 和自定义命令"
      actions={
        <Space size={8} wrap>
          <Input
            allowClear
            size="small"
            className="app-agent-registry-section__search"
            prefix={<SearchOutlined />}
            placeholder="搜索名称、类型、命令或路径"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="small" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增自定义
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void reload(true)}>
            重新探测
          </Button>
        </Space>
      }
      toolbar={
        <AuthorPanelHubTabs aria-label="执行引擎筛选">
          <AuthorPanelHubTab
            active={filter === "all"}
            label="全部"
            count={stats.total}
            onClick={() => setFilter("all")}
          />
          <AuthorPanelHubTab
            active={filter === "available"}
            label="可用"
            count={stats.available}
            onClick={() => setFilter("available")}
          />
          <AuthorPanelHubTab
            active={filter === "custom"}
            label="自定义"
            count={stats.custom}
            onClick={() => setFilter("custom")}
          />
          <AuthorPanelHubTab
            active={filter === "errors"}
            label="异常"
            count={stats.unavailable}
            onClick={() => setFilter("errors")}
          />
        </AuthorPanelHubTabs>
      }
    >
      <AuthorPanelListShell className="app-agent-registry-section__list" aria-busy={loading}>
        {filteredAgents.length === 0 && !loading ? (
          <AuthorPanelEmptyShell>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={getEmptyDescription(filter, query)} />
          </AuthorPanelEmptyShell>
        ) : (
          filteredAgents.map((agent) => (
            <AgentRegistryRow
              key={agent.id}
              agent={agent}
              busy={loading}
              onEdit={openEditModal}
              onDelete={(id) => void handleDelete(id)}
            />
          ))
        )}
      </AuthorPanelListShell>

      <Modal
        title={editingAgent ? "编辑自定义执行引擎" : "新增自定义执行引擎"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>
            取消
          </Button>,
          <Button key="test" loading={testingAgent} onClick={() => void handleTest()}>
            探测
          </Button>,
          <Button key="save" type="primary" loading={savingAgent} disabled={!canSave} onClick={() => void handleSave()}>
            保存
          </Button>,
        ]}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          className="app-agent-registry-form"
          onValuesChange={handleValuesChange}
          initialValues={{ name: "", command: "", argsText: "", envText: "" }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="本地模型 CLI" autoComplete="off" />
          </Form.Item>
          <Form.Item name="command" label="命令" rules={[{ required: true, message: "请输入命令" }]}>
            <Input placeholder="/usr/local/bin/my-agent 或 my-agent" autoComplete="off" />
          </Form.Item>
          <Form.Item name="argsText" label="参数">
            <Input.TextArea rows={3} placeholder="每行一个参数" />
          </Form.Item>
          <Form.Item
            name="envText"
            label="环境变量"
            rules={[
              {
                validator: async (_, value: unknown) => {
                  parseEnvText(typeof value === "string" ? value : "");
                },
              },
            ]}
          >
            <Input.TextArea rows={3} placeholder="KEY=value，每行一个" />
          </Form.Item>
        </Form>
        {testResult ? (
          <Alert
            className="app-agent-registry-form__probe"
            type={testResult.ok ? "success" : "error"}
            showIcon
            title={testResult.ok ? "探测通过" : "探测失败"}
            description={testResult.ok ? testResult.resolvedPath : testResult.error}
          />
        ) : null}
      </Modal>
    </AuthorPanelPageShell>
  );
}

interface AgentRegistryFilterButtonProps {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}

function AgentRegistryFilterButton({ active, count, label, onClick }: AgentRegistryFilterButtonProps) {
  return (
    <button
      type="button"
      className={`app-agent-registry-filter${active ? " app-agent-registry-filter--active" : ""}`}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}

interface AgentRegistryRowProps {
  agent: DetectedAgent;
  busy: boolean;
  onEdit: (agent: DetectedAgent<"custom">) => void;
  onDelete: (id: string) => void;
}

function AgentRegistryRow({ agent, busy, onEdit, onDelete }: AgentRegistryRowProps) {
  const availableTag = agent.available ? (
    <Tag icon={<CheckCircleOutlined />} color="success">
      可用
    </Tag>
  ) : (
    <Tooltip title={agent.failureReason ?? "不可用"}>
      <Tag icon={<CloseCircleOutlined />} color="error">
        不可用
      </Tag>
    </Tooltip>
  );

  return (
    <div className={`app-agent-registry-row${agent.available ? "" : " app-agent-registry-row--error"}`}>
      <span className={`app-agent-registry-row__avatar app-agent-registry-row__avatar--${agent.kind}`} aria-hidden>
        <ThunderboltOutlined />
      </span>
      <div className="app-agent-registry-row__main">
        <div className="app-agent-registry-row__title-line">
          <Typography.Text strong>{agent.name}</Typography.Text>
          <Tag className="app-agent-registry-row__kind">{getAgentKindLabel(agent.kind)}</Tag>
          {availableTag}
          <Tag className="app-agent-registry-row__backend">{agent.backend}</Tag>
        </div>
        <Typography.Text className="app-agent-registry-row__path" code>
          {getAgentPathLabel(agent)}
        </Typography.Text>
        <div className="app-agent-registry-row__meta">
          <span>{describeAgentRuntime(agent)}</span>
          <span>检测时间：{formatDetectedAt(agent.detectedAt)}</span>
        </div>
      </div>
      {isAgentKind(agent, "custom") ? (
        <Space size={4} className="app-agent-registry-row__actions">
          <Button size="small" icon={<EditOutlined />} disabled={busy} onClick={() => onEdit(agent)}>
            编辑
          </Button>
          <Popconfirm
            title="删除自定义执行引擎"
            description="将移除这条已保存的执行引擎配置。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(agent.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={busy}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ) : null}
    </div>
  );
}

function customAgentInputFromForm(values: CustomAgentFormValues, fallbackId: string | undefined): CustomAgentInput {
  return {
    id: values.id?.trim() || fallbackId || null,
    name: values.name.trim(),
    command: values.command.trim(),
    args: parseArgsText(values.argsText),
    env: parseEnvText(values.envText),
  };
}

function parseArgsText(raw: string | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseEnvText(raw: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of (raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      throw new Error("环境变量必须使用 KEY=value 格式");
    }
    const key = trimmed.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`环境变量名无效：${key}`);
    }
    env[key] = trimmed.slice(index + 1);
  }
  return env;
}

function fingerprintFormValues(values: Partial<CustomAgentFormValues>): string {
  return JSON.stringify({
    id: values.id?.trim() ?? "",
    name: values.name?.trim() ?? "",
    command: values.command?.trim() ?? "",
    args: parseArgsText(values.argsText),
    envText: values.envText ?? "",
  });
}
