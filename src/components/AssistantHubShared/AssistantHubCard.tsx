import { DeleteOutlined, EditOutlined, SettingOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { Button, Tag } from "antd";
import type { AssistantEntry } from "../../types/assistant";
import { resolveAssistantKind } from "../CockpitSurface/assistantKind";
import type { AssistantEngineBindingStatus } from "../AssistantsPanel/engineBinding";
import { cardSourceLabel } from "./assistantHubLabels";

export type AssistantHubCardMode = "pick" | "manage";

export interface AssistantHubCardProps {
  assistant: AssistantEntry;
  mode: AssistantHubCardMode;
  disabled?: boolean;
  disabledHint?: string;
  engineStatus?: AssistantEngineBindingStatus;
  onSelect?: () => void;
  onOpenSettings?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function AssistantHubCard({
  assistant,
  mode,
  disabled,
  disabledHint,
  engineStatus,
  onSelect,
  onOpenSettings,
  onEdit,
  onDelete,
}: AssistantHubCardProps) {
  const workflows = assistant.defaultWorkflows ?? [];
  const skills = assistant.defaultSkills ?? [];
  const mcps = assistant.defaultMcps ?? [];
  const assistantKind = resolveAssistantKind(assistant);
  const isCustom = assistant.source === "custom";

  const cardClass = [
    "cockpit-hub__card",
    disabled ? "cockpit-hub__card--disabled" : "",
    `cockpit-hub__card--source-${assistant.source}`,
    `cockpit-hub__card--kind-${assistantKind}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={cardClass}
      style={{
        ["--assistant-avatar-color" as any]: assistant.avatarColor ?? "#1677FF",
      }}
    >
      <div className="cockpit-hub__card-head">
        <span className="cockpit-hub__card-avatar" aria-hidden>
          {assistant.name.slice(0, 1)}
        </span>
        <div className="cockpit-hub__card-id">
          <h3>{assistant.name}</h3>
          <span className="cockpit-hub__card-source">
            {cardSourceLabel(assistant.source, assistantKind)}
          </span>
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
        <span className="cockpit-hub__card-engine">
          {assistant.model ? `${assistant.engineId} · ${assistant.model}` : assistant.engineId}
        </span>
        <div className="cockpit-hub__card-actions">
          {mode === "manage" && engineStatus ? (
            <EngineStatusBadge status={engineStatus} />
          ) : null}
          {mode === "manage" && isCustom && onEdit ? (
            <Button
              size="small"
              type="text"
              className="cockpit-hub__card-action-btn cockpit-hub__card-action-btn--icon"
              icon={<EditOutlined />}
              aria-label={`编辑 ${assistant.name}`}
              onClick={onEdit}
            />
          ) : null}
          {mode === "manage" && isCustom && onDelete ? (
            <Button
              size="small"
              type="text"
              danger
              className="cockpit-hub__card-action-btn cockpit-hub__card-action-btn--icon"
              icon={<DeleteOutlined />}
              aria-label={`删除 ${assistant.name}`}
              onClick={onDelete}
            />
          ) : null}
          {onOpenSettings ? (
            <HoverHint title="设置">
              <Button
                size="small"
                type="text"
                className="cockpit-hub__card-action-btn cockpit-hub__card-action-btn--icon"
                icon={<SettingOutlined />}
                aria-label={`${assistant.name} 设置`}
                onClick={onOpenSettings}
              />
            </HoverHint>
          ) : null}
          {onSelect ? (
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
          ) : null}
        </div>
      </div>
    </article>
  );
}

function EngineStatusBadge({ status }: { status: AssistantEngineBindingStatus }) {
  const dotClass =
    status.dotTone === "on"
      ? "app-assistants-hub__card-status-dot--ok"
      : status.dotTone === "warn"
        ? "app-assistants-hub__card-status-dot--warn"
        : "app-assistants-hub__card-status-dot--muted";

  return (
    <span
      className="app-assistants-hub__card-status cockpit-hub__card-action-btn"
      title={`执行入口：${status.detail}`}
    >
      <span className={`app-assistants-hub__card-status-dot ${dotClass}`} aria-hidden />
      {status.label}
    </span>
  );
}
