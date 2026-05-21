import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Empty, Spin, Tag, Tooltip } from "antd";
import { CloseOutlined, SettingOutlined } from "@ant-design/icons";
import { listAssistants } from "../../services/assistants";
import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantKind, type AssistantKind } from "./assistantKind";
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
  const trellisAssistants = useMemo(
    () => builtinAssistants.filter((assistant) => resolveAssistantKind(assistant) === "trellis-orchestration"),
    [builtinAssistants],
  );
  const builtinSkillAssistants = useMemo(
    () =>
      builtinAssistants.filter((assistant) => {
        const kind = resolveAssistantKind(assistant);
        return kind === "office-doc" || kind === "office-deck" || kind === "skill-artifact";
      }),
    [builtinAssistants],
  );
  const engineeringAssistants = useMemo(
    () => builtinAssistants.filter((assistant) => resolveAssistantKind(assistant) === "engineering"),
    [builtinAssistants],
  );
  const builtinGeneralAssistants = useMemo(
    () => builtinAssistants.filter((assistant) => resolveAssistantKind(assistant) === "general"),
    [builtinAssistants],
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

      {trellisAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">研发编排</h2>
          <div className="cockpit-hub__grid">
            {trellisAssistants.map((assistant) => (
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

      {engineeringAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">研发助手</h2>
          <div className="cockpit-hub__grid">
            {engineeringAssistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                onSelect={() => onSelectAssistant(assistant.id)}
                onOpenSettings={() => onOpenAssistantSettings(assistant.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {builtinSkillAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">内置 Skill 产物</h2>
          <div className="cockpit-hub__grid">
            {builtinSkillAssistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                onSelect={() => onSelectAssistant(assistant.id)}
                onOpenSettings={() => onOpenAssistantSettings(assistant.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {builtinGeneralAssistants.length > 0 ? (
        <section className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">其他内置</h2>
          <div className="cockpit-hub__grid">
            {builtinGeneralAssistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
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
  const assistantKind = resolveAssistantKind(assistant);
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
          <span className="cockpit-hub__card-source">{cardSourceLabel(assistant.source, assistantKind)}</span>
        </div>
      </div>
      {assistant.description ? (
        <p className="cockpit-hub__card-desc">{assistant.description}</p>
      ) : null}
      {workflows.length > 0 || skills.length > 0 || mcps.length > 0 ? (
        <div className="cockpit-hub__card-capabilities" aria-label={`${assistant.name} 默认能力`}>
          {workflows.slice(0, 4).map((workflow) => (
            <Tag key={workflow.id} color="blue">
              内置编排 · {workflow.label}
            </Tag>
          ))}
          {skills.slice(0, 4).map((skill) => (
            <Tag key={skill.id} color="purple">
              内置 Skill · {skill.label}
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
          <Tooltip title="设置" mouseEnterDelay={0.35}>
            <Button
              size="small"
              type="text"
              className="cockpit-hub__card-action-btn cockpit-hub__card-action-btn--icon"
              icon={<SettingOutlined />}
              aria-label={`${assistant.name} 设置`}
              onClick={onOpenSettings}
            />
          </Tooltip>
          <Button
            size="small"
            type="primary"
            className="cockpit-hub__card-action-btn"
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

function cardSourceLabel(source: AssistantEntry["source"], kind: AssistantKind): string {
  if (source !== "builtin") return labelForSource(source);
  switch (kind) {
    case "trellis-orchestration":
      return "Wise 内置编排";
    case "office-doc":
    case "office-deck":
    case "skill-artifact":
      return "Wise 内置 Skill";
    case "engineering":
      return "Wise 研发助手";
    case "general":
      return "Wise 内置";
  }
}
