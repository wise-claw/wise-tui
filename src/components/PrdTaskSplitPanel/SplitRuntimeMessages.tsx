import type { RefObject } from "react";
import { SplitRuntimeMessageRow } from "./SplitRuntimeMessageRow";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";

interface Props {
  logs: SplitRuntimeLogItem[];
  listRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  onRetryStage: (phase: SplitRetryPhase) => void;
}

export function SplitRuntimeMessages({ logs, listRef, retryingPhase, onRetryStage }: Props) {
  return (
    <div className="app-prd-task-panel__split-runtime-list">
      <div ref={listRef} className="app-claude-messages app-prd-task-panel__split-runtime-messages">
        {logs.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无处理记录</p>
          </div>
        ) : (
          logs.map((log) => (
            <SplitRuntimeMessageRow
              key={log.id}
              log={log}
              retryingPhase={retryingPhase}
              onRetryStage={onRetryStage}
            />
          ))
        )}
      </div>
    </div>
  );
}
