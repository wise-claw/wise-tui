import { StopOutlined } from "@ant-design/icons";
import { memo } from "react";
import type { SessionConversationTaskItem } from "../../types";
import { SubagentStatusIndicator, type SubagentStatusVisual } from "./SubagentStatusIndicator";
import { formatExecutionEnvironmentDispatchSavedTime } from "../../utils/sessionConversationTasks";

function MonitorItemTypeTag({ label }: { label: string }) {
  return <span className="app-monitor-panel__item-type-tag">{label}</span>;
}

function resolveDispatchRowResultPreview(item: SessionConversationTaskItem): string {
  if (item.status === "running") return "";
  const preview = item.previewText.replace(/\s+/g, " ").trim();
  if (!preview || preview === item.label.replace(/\s+/g, " ").trim()) return "";
  if (preview === "执行中…" || preview === "已完成") return "";
  return preview;
}

export const SessionConversationDispatchTaskRow = memo(function SessionConversationDispatchTaskRow({
  item,
  showStop,
  onOpenDetail,
  onStop,
  statusVisual = "full",
}: {
  item: SessionConversationTaskItem;
  showStop: boolean;
  onOpenDetail: (item: SessionConversationTaskItem) => void;
  onStop?: (item: SessionConversationTaskItem) => void;
  statusVisual?: SubagentStatusVisual;
}) {
  const savedTime = formatExecutionEnvironmentDispatchSavedTime(item.updatedAt);
  const resultPreview = resolveDispatchRowResultPreview(item);
  const rowTitle = [item.label, item.subtitle, resultPreview, savedTime].filter(Boolean).join(" · ");

  return (
    <div className="app-monitor-panel__session-task-row app-monitor-panel__item">
      <div className="app-monitor-panel__item-row app-monitor-panel__item-row--dispatch">
        <button
          type="button"
          className="app-monitor-panel__item-row-main"
          title={rowTitle}
          onClick={() => onOpenDetail(item)}
        >
          <span className="app-monitor-panel__item-name-wrap">
            <MonitorItemTypeTag label="派发" />
            <span className="app-monitor-panel__item-name" title={item.label}>
              {item.label}
            </span>
          </span>
        </button>
        {item.subtitle ? (
          <span
            className="app-monitor-panel__session-task-meta app-monitor-panel__session-task-engine"
            title={item.subtitle}
          >
            {item.subtitle}
          </span>
        ) : null}
        {resultPreview ? (
          <span className="app-monitor-panel__session-task-preview" title={resultPreview}>
            {resultPreview}
          </span>
        ) : item.status === "running" ? (
          <span className="app-monitor-panel__session-task-preview app-monitor-panel__session-task-preview--pending">
            执行中…
          </span>
        ) : null}
        {savedTime ? (
          <span className="app-monitor-panel__session-task-time" title={savedTime}>
            {savedTime}
          </span>
        ) : null}
        <span className="app-monitor-panel__item-actions app-monitor-panel__session-task-actions">
          {showStop ? (
            <button
              type="button"
              className="app-monitor-panel__session-task-stop"
              title="结束执行"
              aria-label="结束执行"
              onClick={(event) => {
                event.stopPropagation();
                onStop?.(item);
              }}
            >
              <StopOutlined />
            </button>
          ) : null}
          <SubagentStatusIndicator status={item.status} visual={statusVisual} />
        </span>
      </div>
    </div>
  );
});
