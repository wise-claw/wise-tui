import { Dropdown, Tooltip, type MenuProps } from "antd";
import {
  CLAUDE_CONNECTION_KIND_LABELS,
  normalizeClaudeConnectionKind,
  type ClaudeSessionConnectionKind,
} from "../../constants/claudeConnection";

const SHORT_LABEL: Record<ClaudeSessionConnectionKind, string> = {
  streaming: "长驻",
  oneshot: "逐轮",
};

interface Props {
  connectionKind?: ClaudeSessionConnectionKind | null;
  onConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  disabled?: boolean;
  className?: string;
}

export function ClaudeConnectionKindChip({
  connectionKind,
  onConnectionKindChange,
  disabled = false,
  className,
}: Props) {
  const kind = normalizeClaudeConnectionKind(connectionKind);
  const meta = CLAUDE_CONNECTION_KIND_LABELS[kind];
  const interactive = Boolean(onConnectionKindChange) && !disabled;

  const menuItems: MenuProps["items"] = (["streaming", "oneshot"] as const).map((key) => {
    const itemMeta = CLAUDE_CONNECTION_KIND_LABELS[key];
    return {
      key,
      label: (
        <div className="app-claude-connection-kind-menu-item">
          <span className="app-claude-connection-kind-menu-item__title">{itemMeta.title}</span>
          <span className="app-claude-connection-kind-menu-item__desc">{itemMeta.description}</span>
        </div>
      ),
    };
  });

  const chip = (
    <span
      className={`app-claude-connection-kind-chip${
        interactive ? " app-claude-connection-kind-chip--interactive" : ""
      }${className ? ` ${className}` : ""}`}
      aria-label={`连接方式：${meta.title}`}
      aria-haspopup={interactive ? "menu" : undefined}
    >
      {SHORT_LABEL[kind]}
      {interactive ? (
        <svg
          className="app-claude-connection-kind-chip__chevron"
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      ) : null}
    </span>
  );

  if (!interactive) {
    return (
      <Tooltip title={meta.description} placement="top">
        {chip}
      </Tooltip>
    );
  }

  return (
    <Dropdown
      overlayClassName="app-claude-connection-kind-dropdown"
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys: [kind],
        onClick: ({ key }) => {
          const next = normalizeClaudeConnectionKind(key);
          if (next !== kind) onConnectionKindChange?.(next);
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
    >
      <Tooltip title="点击切换本标签的连接方式" placement="top">
        <button type="button" className="app-claude-connection-kind-chip-btn">
          {chip}
        </button>
      </Tooltip>
    </Dropdown>
  );
}
