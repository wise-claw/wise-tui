import {
  CloseCircleOutlined,
  CopyOutlined,
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
          <Button type="primary" size="small" className="app-agent-registry-btn-add" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增自定义
          </Button>
          <Button size="small" className="app-agent-registry-btn-reload" icon={<ReloadOutlined />} loading={loading} onClick={() => void reload(true)}>
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
      {/* 顶部紧凑运行状态仪表盘 */}
      <div className="app-agent-registry-dashboard">
        <div className="app-agent-registry-metric-card app-agent-registry-metric-card--total">
          <div className="app-agent-registry-metric-card__icon">
            <ThunderboltOutlined />
          </div>
          <div className="app-agent-registry-metric-card__content">
            <strong>{stats.total}</strong>
            <small>总执行引擎</small>
          </div>
        </div>
        <div className="app-agent-registry-metric-card app-agent-registry-metric-card--available">
          <div className="app-agent-registry-metric-card__icon">
            <span className="app-agent-registry-metric-card__dot-pulsing" />
          </div>
          <div className="app-agent-registry-metric-card__content">
            <strong>{stats.available}</strong>
            <small>就绪可用</small>
          </div>
        </div>
        <div className="app-agent-registry-metric-card app-agent-registry-metric-card--custom">
          <div className="app-agent-registry-metric-card__icon">
            <PlusOutlined />
          </div>
          <div className="app-agent-registry-metric-card__content">
            <strong>{stats.custom}</strong>
            <small>自定义入口</small>
          </div>
        </div>
        <div className="app-agent-registry-metric-card app-agent-registry-metric-card--errors">
          <div className="app-agent-registry-metric-card__icon">
            <CloseCircleOutlined />
          </div>
          <div className="app-agent-registry-metric-card__content">
            <strong>{stats.unavailable}</strong>
            <small>异常待排查</small>
          </div>
        </div>
      </div>

      <AuthorPanelListShell className="app-agent-registry-section__list" aria-busy={loading}>
        {filteredAgents.length === 0 && !loading ? (
          <AuthorPanelEmptyShell>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={getEmptyDescription(filter, query)} />
          </AuthorPanelEmptyShell>
        ) : (
          <div className="app-agent-registry-grid">
            {filteredAgents.map((agent) => (
              <AgentRegistryRow
                key={agent.id}
                agent={agent}
                busy={loading}
                onEdit={openEditModal}
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
          </div>
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
            <Input.TextArea rows={3} placeholder="每行一个参数" style={{ fontFamily: "monospace" }} />
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
            <Input.TextArea rows={3} placeholder="KEY=value，每行一个" style={{ fontFamily: "monospace" }} />
          </Form.Item>
        </Form>
        {testResult ? (
          <Alert
            className="app-agent-registry-form__probe"
            type={testResult.ok ? "success" : "error"}
            showIcon
            title={testResult.ok ? "探测通过" : "探测失败"}
            description={
              <div style={{ fontFamily: "monospace", fontSize: "11px", whiteSpace: "pre-wrap" }}>
                {testResult.ok ? testResult.resolvedPath : testResult.error}
              </div>
            }
          />
        ) : null}
      </Modal>
    </AuthorPanelPageShell>
  );
}

interface AgentRegistryRowProps {
  agent: DetectedAgent;
  busy: boolean;
  onEdit: (agent: DetectedAgent<"custom">) => void;
  onDelete: (id: string) => void;
}

function AgentRegistryRow({ agent, busy, onEdit, onDelete }: AgentRegistryRowProps) {
  const pathText = getAgentPathLabel(agent);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(pathText)
      .then(() => {
        message.success("路径已复制到剪贴板");
      })
      .catch(() => {
        message.error("复制失败");
      });
  }, [pathText]);

  const brandClass = `app-agent-registry-card--${agent.kind}`;

  return (
    <article className={`app-agent-registry-card ${brandClass} ${agent.available ? "" : "app-agent-registry-card--error"}`}>
      {/* 头部：Avatar 品牌图标与引擎状态灯 */}
      <div className="app-agent-registry-card__header">
        <span className={`app-agent-registry-card__avatar app-agent-registry-card__avatar--${agent.kind}`}>
          <ThunderboltOutlined />
        </span>
        <div className="app-agent-registry-card__title-area">
          <Typography.Text className="app-agent-registry-card__title" strong>
            {agent.name}
          </Typography.Text>
          <div className="app-agent-registry-card__subtitle">
            {getAgentKindLabel(agent.kind)} · {agent.backend}
          </div>
        </div>

        <div className="app-agent-registry-card__status">
          {agent.available ? (
            <Tag color="success" className="app-agent-registry-card__status-tag">
              <span className="app-agent-registry-card__status-indicator app-agent-registry-card__status-indicator--ok" />
              就绪可用
            </Tag>
          ) : (
            <Tooltip title={agent.failureReason ?? "当前环境尚未配置就绪"}>
              <Tag color="error" className="app-agent-registry-card__status-tag">
                <span className="app-agent-registry-card__status-indicator app-agent-registry-card__status-indicator--error" />
                等待就绪
              </Tag>
            </Tooltip>
          )}
        </div>
      </div>

      {/* 命令/路径 Monospace 显示区 */}
      <div className="app-agent-registry-card__path-box">
        <span className="app-agent-registry-card__path-icon">💻</span>
        <code className="app-agent-registry-card__path-code" title={pathText}>
          {pathText}
        </code>
        <Tooltip title="复制路径">
          <Button
            type="text"
            size="small"
            className="app-agent-registry-card__copy-btn"
            icon={<CopyOutlined style={{ fontSize: "11px" }} />}
            onClick={handleCopy}
          />
        </Tooltip>
      </div>

      {/* 中部 Meta 运行时介绍 */}
      <div className="app-agent-registry-card__runtime-desc">
        {describeAgentRuntime(agent)}
      </div>

      {/* 底部 actions 和时间戳 */}
      <div className="app-agent-registry-card__footer">
        <span className="app-agent-registry-card__timestamp">
          探测于 {formatDetectedAt(agent.detectedAt)}
        </span>

        {isAgentKind(agent, "custom") ? (
          <Space size={4} className="app-agent-registry-card__actions">
            <Button size="small" type="text" icon={<EditOutlined />} disabled={busy} onClick={() => onEdit(agent)}>
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
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={busy}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : null}
      </div>
    </article>
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
