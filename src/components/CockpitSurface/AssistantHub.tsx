import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Empty, Spin, Tag } from "antd";
import { CloseOutlined, SettingOutlined } from "@ant-design/icons";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import "./index.css";

export interface AssistantHubProps {
  /** 关联工作区(可选);影响选中助手后能否直接进入对话。 */
  activeProjectId: string | null;
  activeProjectName: string | null;
  onSelectAssistant: (assistantId: string) => void;
  onOpenAssistantSettings: (assistantId: string) => void;
  onOpenChat: () => void;
}

/**
 * Cockpit 默认空态:AionUI 风格的助手卡片网格 + 内置 PRD 拆分助手作为头牌。
 * Wave A 仅展示卡片 + 一键进入对话;最近对话 / 输入条由 Wave B 接入。
 */
export function AssistantHub({
  activeProjectId,
  activeProjectName,
  onSelectAssistant,
  onOpenAssistantSettings,
  onOpenChat,
}: AssistantHubProps) {
  const { message } = AntdApp.useApp();
  const [assistants, setAssistants] = useState<AssistantEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAssistants()
      .then((rows) => {
        if (!cancelled) setAssistants(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          message.error(err instanceof Error ? err.message : String(err));
          setAssistants([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  const builtinAssistants = useMemo(
    () => assistants?.filter((a) => a.source === "builtin") ?? [],
    [assistants],
  );
  const otherAssistants = useMemo(
    () => assistants?.filter((a) => a.source !== "builtin") ?? [],
    [assistants],
  );

  if (loading) {
    return (
      <div className="cockpit-hub" aria-busy="true">
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div className="cockpit-hub">
      <header className="cockpit-hub__header">
        <div className="cockpit-hub__header-top">
          <h1 className="cockpit-hub__title">助手 Hub</h1>
          <button
            type="button"
            className="cockpit-hub__close-btn"
            aria-label="关闭"
            title="关闭"
            onClick={onOpenChat}
          >
            <CloseOutlined />
          </button>
        </div>
        <p className="cockpit-hub__subtitle">
          {activeProjectName
            ? `当前工作区：${activeProjectName}。选择一个助手开始工作。`
            : "选择一个助手开始工作。需要拆分 PRD 时建议先在左栏选定一个工作区。"}
        </p>
      </header>

      {builtinAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">Wise 内置</h2>
          <div className="cockpit-hub__grid">
            {builtinAssistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                disabled={false}
                disabledHint={activeProjectId ? undefined : "未选择工作区时会先进入助手空态"}
                onSelect={() => onSelectAssistant(assistant.id)}
                onOpenSettings={() => onOpenAssistantSettings(assistant.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {otherAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">自建与扩展</h2>
          <div className="cockpit-hub__grid">
            {otherAssistants.map((a) => (
              <AssistantCard
                key={a.id}
                assistant={a}
                onSelect={() => onSelectAssistant(a.id)}
                onOpenSettings={() => onOpenAssistantSettings(a.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {assistants && assistants.length === 0 ? (
        <Empty description="尚未注册任何助手" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : null}
    </div>
  );
}

interface AssistantCardProps {
  assistant: AssistantEntry;
  disabled?: boolean;
  disabledHint?: string;
  onSelect: () => void;
  onOpenSettings: () => void;
}

function AssistantCard({ assistant, disabled, disabledHint, onSelect, onOpenSettings }: AssistantCardProps) {
  const workflows = assistant.defaultWorkflows ?? [];
  const skills = assistant.defaultSkills ?? [];
  const mcps = assistant.defaultMcps ?? [];
  return (
    <article className={`cockpit-hub__card${disabled ? " cockpit-hub__card--disabled" : ""}`}>
      <div className="cockpit-hub__card-head">
        <span
          className="cockpit-hub__card-avatar"
          style={{ background: assistant.avatarColor ?? "#1677FF" }}
          aria-hidden
        >
          {assistant.name.slice(0, 1)}
        </span>
        <div className="cockpit-hub__card-id">
          <h3>{assistant.name}</h3>
          <span className="cockpit-hub__card-source">{labelForSource(assistant.source)}</span>
        </div>
      </div>
      {assistant.description ? (
        <p className="cockpit-hub__card-desc">{assistant.description}</p>
      ) : null}
      {workflows.length > 0 || skills.length > 0 || mcps.length > 0 ? (
        <div className="cockpit-hub__card-capabilities" aria-label={`${assistant.name} 默认能力`}>
          {workflows.slice(0, 4).map((workflow) => (
            <Tag key={workflow.id} color="blue">
              流程 · {workflow.label}
            </Tag>
          ))}
          {skills.slice(0, 4).map((skill) => (
            <Tag key={skill.id} color="purple">
              Skill · {skill.label}
            </Tag>
          ))}
          {mcps.slice(0, 3).map((mcp) => (
            <Tag key={mcp.id} color="green">
              MCP · {mcp.label}
            </Tag>
          ))}
        </div>
      ) : null}
      <div className="cockpit-hub__card-foot">
        <span className="cockpit-hub__card-engine">{assistant.engineId}</span>
        <div className="cockpit-hub__card-actions">
          <Button
            size="small"
            type="text"
            icon={<SettingOutlined />}
            aria-label={`${assistant.name} 设置`}
            onClick={onOpenSettings}
          >
            设置
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={disabled}
            title={disabled ? disabledHint : undefined}
            onClick={onSelect}
          >
            打开
          </Button>
        </div>
      </div>
    </article>
  );
}

function labelForSource(source: AssistantEntry["source"]): string {
  switch (source) {
    case "builtin":
      return "内置";
    case "custom":
      return "自定义";
    case "extension":
      return "扩展";
  }
}
