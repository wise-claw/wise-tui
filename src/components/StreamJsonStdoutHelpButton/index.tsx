import { Tooltip } from "antd";
import { MAX_STDOUT_LINES_FOR_STREAM_PARTS } from "../../utils/backgroundInvocationStdoutParts";
import "./index.css";

export const STREAM_JSON_STDOUT_DISPLAY_TOOLTIP = `与主会话相同的气泡与解析：stdout 按 Claude Code stream-json 合并为文本 / 思考 / 工具块（与「后台执行详情」一致，最近约 ${MAX_STDOUT_LINES_FOR_STREAM_PARTS} 行参与解析）；订阅追加的行会实时出现，缓冲区约 3500 行。`;

interface Props {
  /** 无障碍名称，默认「stdout 解析与缓冲说明」 */
  ariaLabel?: string;
  /** 覆盖默认说明（例如直连批量与「后台执行详情」缓冲上限不同） */
  tooltipTitle?: string;
}

export function StreamJsonStdoutHelpButton({ ariaLabel, tooltipTitle }: Props) {
  return (
    <Tooltip title={tooltipTitle ?? STREAM_JSON_STDOUT_DISPLAY_TOOLTIP} placement="topLeft" overlayStyle={{ maxWidth: 440 }}>
      <button type="button" className="app-stream-json-stdout-help-btn" aria-label={ariaLabel ?? "stdout 解析与缓冲说明"}>
        <svg
          className="app-stream-json-stdout-help-icon"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M6.35 6.1c0-1.05.75-1.75 1.75-1.75 1.05 0 1.75.65 1.75 1.45 0 .65-.35 1.05-1 1.45-.45.28-.65.55-.65 1.05"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="12.15" r="0.55" fill="currentColor" />
        </svg>
      </button>
    </Tooltip>
  );
}
