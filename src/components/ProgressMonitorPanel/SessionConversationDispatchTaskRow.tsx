import { StopOutlined } from "@ant-design/icons";
import type { SessionConversationTaskItem } from "../../types";
import { SubagentStatusIndicator } from "./SubagentStatusIndicator";
import { formatExecutionEnvironmentDispatchSavedTime } from "../../utils/sessionConversationTasks";

function MonitorItemTypeTag({ label }: { label: string }) {
  return <span className="app-monitor-panel__item-type-tag">{label}</span>;
}

export function SessionConversationDispatchTaskRow({
  item,
  showStop,
  onOpenDetail,
  onStop,
}: {
  item: SessionConversationTaskItem;
  showStop: boolean;
  onOpenDetail: (item: SessionConversationTaskItem) => void;
  onStop?: (item: SessionConversationTaskItem) => void;
}) {
  const savedTime = formatExecutionEnvironmentDispatchSavedTime(item.updatedAt);

  return (
    <div className="app-monitor-panel__session-task-row">
      <button
        type="button"
        className="app-monitor-panel__session-task-row-main"
        title={item.subtitle ? `${item.label} · ${item.subtitle}` : item.label}
        onClick={() => onOpenDetail(item)}
      >
        <span className="app-monitor-panel__item-name-wrap app-monitor-panel__session-task-name-wrap">
          <MonitorItemTypeTag label="派发" />
          <span className="app-monitor-panel__session-task-name" title={item.label}>
            {item.label}
          </span>
        </span>
        {item.subtitle ? (
          <span className="app-monitor-panel__session-task-meta">{item.subtitle}</span>
        ) : null}
        {savedTime ? (
          <span className="app-monitor-panel__session-task-time" title={savedTime}>
            {savedTime}
          </span>
        ) : null}
      </button>
      <span className="app-monitor-panel__session-task-actions">
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
        <SubagentStatusIndicator status={item.status} />
      </span>
    </div>
  );
}
