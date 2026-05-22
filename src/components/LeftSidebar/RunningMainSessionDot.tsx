import { CloseOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

export function RunningMainSessionDot({ onStop }: { onStop?: () => void }) {
  if (!onStop) {
    return (
      <span
        className="app-repository-main-session-running-dot"
        aria-label="主会话运行中"
        title="Claude Code 主会话运行中"
      />
    );
  }

  return (
    <span
      className="app-repository-main-session-running-dot-wrap"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="app-repository-main-session-running-dot" aria-hidden />
      <Tooltip title="关闭 Claude 会话" mouseEnterDelay={0.2}>
        <button
          type="button"
          className="app-repository-main-session-running-stop"
          aria-label="关闭 Claude 会话"
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
