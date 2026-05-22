import { Spin } from "antd";
import {
  formatContextTokenCount,
  type ContextBreakdownSnapshot,
} from "../../services/claudeContextBreakdown";

export interface ContextDetailPopoverProps {
  breakdown: ContextBreakdownSnapshot | null;
  loading?: boolean;
  compactHint?: string;
}

export function ContextDetailPopover({
  breakdown,
  loading = false,
  compactHint,
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

  const visibleCategories = breakdown.categories.filter((c) => c.tokens > 0);

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
        {visibleCategories.map((cat) => (
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
        {visibleCategories.map((cat) => (
          <li key={cat.id} className="app-claude-context-detail__row">
            <span
              className="app-claude-context-detail__swatch"
              style={{ backgroundColor: cat.color }}
              aria-hidden
            />
            <span className="app-claude-context-detail__label">{cat.label}</span>
            <span className="app-claude-context-detail__value">
              {formatContextTokenCount(cat.tokens)}
            </span>
          </li>
        ))}
      </ul>

      {compactHint ? (
        <p className="app-claude-context-detail__hint">{compactHint}</p>
      ) : null}
    </div>
  );
}
