import { CloseOutlined } from "@ant-design/icons";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";

export type RunningMainSessionDotProps = {
  onStop?: () => void;
  /** 运行中提示（默认：运行指令） */
  runningTitle?: string;
  /** 停止按钮提示 */
  stopTitle?: string;
};

export function RunningMainSessionDot({
  onStop,
  runningTitle = "运行指令执行中",
  stopTitle = "停止运行",
}: RunningMainSessionDotProps) {
  const dot = (
    <span
      className="app-repository-main-session-running-dot app-repository-run-command-running-dot--active"
      aria-hidden={Boolean(onStop)}
      aria-label={onStop ? undefined : runningTitle}
    />
  );

  if (!onStop) {
    return <DeferredHoverTooltip title={runningTitle}>{dot}</DeferredHoverTooltip>;
  }

  return (
    <DeferredHoverTooltip title={runningTitle}>
      <span
        className="app-repository-main-session-running-dot-wrap app-repository-run-command-running-dot-wrap"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {dot}
        <DeferredHoverTooltip title={stopTitle}>
          <button
            type="button"
            className="app-repository-main-session-running-stop"
            aria-label={stopTitle}
            onClick={(event) => {
              event.stopPropagation();
              onStop();
            }}
          >
            <CloseOutlined />
          </button>
        </DeferredHoverTooltip>
      </span>
    </DeferredHoverTooltip>
  );
}
