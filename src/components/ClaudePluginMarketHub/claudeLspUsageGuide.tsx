import { Tooltip, Typography } from "antd";
import { openClaudeLspPluginsDoc } from "../../services/claudeLspUsageGuide";

export function ClaudeLspUsageTooltipContent() {
  return (
    <div className="app-claude-lsp-usage-tip">
      <div className="app-claude-lsp-usage-tip-title">Claude Code 语言服务（LSP）</div>
      <ol className="app-claude-lsp-usage-tip-list">
        <li>在此一键安装官方 LSP 插件（user 作用域）；安装完成后请新开 Claude 会话。</li>
        <li>
          插件不包含语言服务器本体：请在本机安装对应二进制并确保在 PATH 中（如 pyright、typescript-language-server、rust-analyzer、jdtls）。
        </li>
        <li>终端执行 <code>claude plugin list</code> 确认插件为 enabled；若仍无 LSP 能力，可在 ~/.claude/settings.json 设置{" "}
          <code>ENABLE_LSP_TOOL=1</code> 后重启 Claude Code。
        </li>
        <li>安装较慢时请看顶部「正在处理」提示；超时后可到「已安装」确认或点「刷新市场」后重试。</li>
      </ol>
      <Typography.Link
        className="app-claude-lsp-usage-tip-link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openClaudeLspPluginsDoc();
        }}
      >
        官方插件文档
      </Typography.Link>
    </div>
  );
}

interface ClaudeLspHelpIconProps {
  className?: string;
}

/** 问号图标；hover 展示 Claude Code LSP 使用说明。 */
export function ClaudeLspHelpIcon({ className }: ClaudeLspHelpIconProps) {
  return (
    <Tooltip
      title={<ClaudeLspUsageTooltipContent />}
      placement="bottom"
      overlayClassName="app-claude-lsp-usage-tip-overlay"
      mouseEnterDelay={0.25}
      mouseLeaveDelay={0.2}
      styles={{
        root: { pointerEvents: "none" },
        body: { pointerEvents: "auto" },
      }}
    >
      <span
        className={`app-claude-plugin-hub-lsp-help-icon ${className ?? ""}`.trim()}
        role="img"
        aria-label="Claude Code 语言服务使用说明"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6.4 5.9c0-1 0.82-1.7 1.9-1.7 1.05 0 1.85 0.64 1.85 1.62 0 0.68-0.35 1.13-1.03 1.58-0.69 0.46-0.92 0.73-0.92 1.35v0.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="8.2" cy="11.7" r="0.8" fill="currentColor" />
        </svg>
      </span>
    </Tooltip>
  );
}
