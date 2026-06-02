import { DeleteOutlined, GlobalOutlined, HolderOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, List } from "antd";
import { memo, type DragEvent } from "react";
import { openExternalUrl } from "../../services/openExternal";
import type { ClaudeModelProfile } from "../../types/claudeModelProfile";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { normalizeModelProfileOfficialWebsite } from "../../utils/modelProfileOfficialWebsite";

interface Props {
  item: ClaudeModelProfile;
  active: boolean;
  applying?: boolean;
  sortable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  reordering?: boolean;
  onApply: (profileId: string) => void;
  onConfigure: (profile: ClaudeModelProfile) => void;
  onDelete: (profileId: string) => void;
  onDragHandleStart?: (event: DragEvent<HTMLSpanElement>) => void;
  onDragHandleEnd?: () => void;
  onRowDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onRowDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onRowDragLeave?: () => void;
}

function ModelProfileListRowInner({
  item,
  active,
  applying = false,
  sortable = false,
  dragging = false,
  dragOver = false,
  reordering = false,
  onApply,
  onConfigure,
  onDelete,
  onDragHandleStart,
  onDragHandleEnd,
  onRowDragOver,
  onRowDrop,
  onRowDragLeave,
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
        (applying ? " app-claude-model-topbar-panel__item--applying" : "") +
        (dragging ? " app-claude-model-topbar-panel__item--dragging" : "") +
        (dragOver ? " app-claude-model-topbar-panel__item--drag-over" : "")
      }
      onDragOver={sortable ? onRowDragOver : undefined}
      onDrop={sortable ? onRowDrop : undefined}
      onDragLeave={sortable ? onRowDragLeave : undefined}
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
      <div className="app-claude-model-topbar-panel__item-body">
        {sortable ? (
          <span
            className="app-claude-model-topbar-panel__item-drag-handle"
            draggable={!applying && !reordering}
            title="拖拽调整自动切换优先级"
            aria-label={`拖拽调整 ${item.name} 的优先级`}
            onDragStart={(event) => {
              onDragHandleStart?.(event);
            }}
            onDragEnd={() => {
              onDragHandleEnd?.();
            }}
          >
            <HolderOutlined />
          </span>
        ) : null}
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
      </div>
    </List.Item>
  );
}

export const ModelProfileListRow = memo(ModelProfileListRowInner);
