import { Spin } from "antd";
import {
  formatContextTokenCount,
  type ContextBreakdownSnapshot,
} from "../../services/claudeContextBreakdown";

export interface ContextDetailPopoverProps {
  breakdown: ContextBreakdownSnapshot | null;
  loading?: boolean;
}

export function ContextDetailPopover({
  breakdown,
  loading = false,
}: ContextDetailPopoverProps) {
  if (loading && !breakdown) {
    return (
      <div className="app-claude-context-detail">
        <div className="app-claude-context-detail__loading">
          <Spin size="small" />
          <span>正在估算上下文…</span>
        </div>
      </div>
    );
  }

  if (!breakdown) {
    return (
      <div className="app-claude-context-detail">
        <div className="app-claude-context-detail__empty">暂无上下文数据</div>
      </div>
    );
  }

  const barCategories = breakdown.categories.filter((c) => c.tokens > 0);
  const conversationTokens =
    breakdown.categories.find((c) => c.id === "conversation")?.tokens ?? 0;

  return (
    <div className="app-claude-context-detail">
      <div className="app-claude-context-detail__head">
        <span className="app-claude-context-detail__title">上下文</span>
        {breakdown.estimated ? (
          <span className="app-claude-context-detail__badge">估算</span>
        ) : null}
      </div>

      <div className="app-claude-context-detail__summary">
        <span className="app-claude-context-detail__percent">{breakdown.ctxPercent}% 已用</span>
        <span className="app-claude-context-detail__totals">
          ~{formatContextTokenCount(breakdown.totalTokens)} /{" "}
          {formatContextTokenCount(breakdown.maxTokens)} Tokens
        </span>
      </div>

      <div
        className="app-claude-context-detail__bar"
        role="img"
        aria-label={`上下文占用约 ${breakdown.ctxPercent}%`}
      >
        {barCategories.map((cat) => (
          <span
            key={cat.id}
            className="app-claude-context-detail__bar-seg"
            style={{
              flexGrow: cat.tokens,
              flexBasis: 0,
              backgroundColor: cat.color,
            }}
          />
        ))}
      </div>

      <ul className="app-claude-context-detail__list">
        {breakdown.categories.map((cat) => (
          <li key={cat.id} className="app-claude-context-detail__row">
            <span
              className="app-claude-context-detail__swatch"
              style={{ backgroundColor: cat.color }}
              aria-hidden
            />
            <span className="app-claude-context-detail__label">{cat.label}</span>
            <span className="app-claude-context-detail__value">
              {cat.tokens > 0 ? formatContextTokenCount(cat.tokens) : "—"}
            </span>
          </li>
        ))}
      </ul>

      <p className="app-claude-context-detail__meta">
        底栏圆环按对话约 {formatContextTokenCount(conversationTokens)} tokens；
        合计含启动项。终端执行 <code>/context</code> 可看 Claude 官方实测。
      </p>
    </div>
  );
}
