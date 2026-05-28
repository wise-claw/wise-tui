import { CloseOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

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
  if (!onStop) {
    return (
      <span
        className="app-repository-main-session-running-dot app-repository-run-command-running-dot--active"
        aria-label={runningTitle}
        title={runningTitle}
      />
    );
  }

  return (
    <span
      className="app-repository-main-session-running-dot-wrap app-repository-run-command-running-dot-wrap"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span
        className="app-repository-main-session-running-dot app-repository-run-command-running-dot--active"
        aria-hidden
      />
      <Tooltip title={stopTitle} mouseEnterDelay={0.2}>
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
      </Tooltip>
    </span>
  );
}
