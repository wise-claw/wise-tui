import { DeleteOutlined, GlobalOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, List } from "antd";
import { memo } from "react";
import { openExternalUrl } from "../../services/openExternal";
import type { ClaudeModelProfile } from "../../types/claudeModelProfile";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { normalizeModelProfileOfficialWebsite } from "../../utils/modelProfileOfficialWebsite";

interface Props {
  item: ClaudeModelProfile;
  active: boolean;
  applying?: boolean;
  onApply: (profileId: string) => void;
  onConfigure: (profile: ClaudeModelProfile) => void;
  onDelete: (profileId: string) => void;
}

function ModelProfileListRowInner({
  item,
  active,
  applying = false,
  onApply,
  onConfigure,
  onDelete,
}: Props) {
  const company = (item.company ?? "").trim();
  const name = (item.name ?? "").trim();
  const modelLabel = formatClaudeModelLabel(item.modelId ?? "");
  const officialWebsiteUrl = normalizeModelProfileOfficialWebsite(item.officialWebsiteUrl ?? "");

  return (
    <List.Item
      className={
        "app-claude-model-topbar-panel__item" +
        (active ? " app-claude-model-topbar-panel__item--active" : "") +
        (applying ? " app-claude-model-topbar-panel__item--applying" : "")
      }
      actions={[
        <span key="actions" className="app-claude-model-topbar-panel__item-actions">
          {officialWebsiteUrl ? (
            <Button
              type="text"
              size="small"
              icon={<GlobalOutlined />}
              aria-label={`打开 ${item.name} 官网`}
              title="打开官网"
              className="app-claude-model-topbar-panel__item-website"
              onClick={(e) => {
                e.stopPropagation();
                void openExternalUrl(officialWebsiteUrl);
              }}
            />
          ) : null}
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined />}
            aria-label={`配置 ${item.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onConfigure(item);
            }}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label={`删除 ${item.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
          />
        </span>,
      ]}
    >
      <button
        type="button"
        className="app-claude-model-topbar-panel__item-main"
        disabled={applying}
        aria-busy={applying}
        onClick={() => onApply(item.id)}
        title={company ? `${company} ${modelLabel}` : item.name}
      >
        <span className="app-claude-model-topbar-panel__item-label">
          {company ? (
            <>
              <span className="app-claude-model-topbar-panel__item-company">{company}</span>
              <span className="app-claude-model-topbar-panel__item-model">{modelLabel}</span>
            </>
          ) : (
            <>
              <span className="app-claude-model-topbar-panel__item-name">
                {name || modelLabel}
              </span>
              {name ? (
                <span className="app-claude-model-topbar-panel__item-model">{modelLabel}</span>
              ) : null}
            </>
          )}
        </span>
      </button>
    </List.Item>
  );
}

export const ModelProfileListRow = memo(ModelProfileListRowInner);
