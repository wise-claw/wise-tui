import { Dropdown, Menu, Tooltip, type MenuProps } from "antd";
import { useMemo } from "react";
import {
  CLAUDE_CONNECTION_KIND_LABELS,
  CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  isTabConnectionKindOverride,
  resolveSessionConnectionKind,
  type ClaudeSessionConnectionKind,
} from "../../constants/claudeConnection";

const SHORT_LABEL: Record<ClaudeSessionConnectionKind, string> = {
  streaming: "长驻",
  oneshot: "逐轮",
};

interface PickerSectionProps {
  connectionKind?: ClaudeSessionConnectionKind | null;
  defaultConnectionKind?: ClaudeSessionConnectionKind;
  onConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
}

interface ChipProps extends PickerSectionProps {
  disabled?: boolean;
  className?: string;
}

export function buildConnectionKindMenuItems(
  kind: ClaudeSessionConnectionKind,
  defaultConnectionKind: ClaudeSessionConnectionKind,
): MenuProps["items"] {
  return (["oneshot", "streaming"] as const).map((key) => {
    const itemMeta = CLAUDE_CONNECTION_KIND_LABELS[key];
    const isGlobalDefault = key === defaultConnectionKind;
    const isSelected = kind === key;
    return {
      key,
      className: `app-claude-connection-kind-menu-item-wrapper ${
        isSelected ? "app-claude-connection-kind-menu-item-wrapper--selected" : ""
      }`,
      label: (
        <div
          className={`app-claude-connection-kind-menu-item${
            isSelected ? " app-claude-connection-kind-menu-item--selected" : ""
          }`}
        >
          <div className="app-claude-connection-kind-menu-item__body">
            <span className="app-claude-connection-kind-menu-item__title">
              {itemMeta.title}
              {isGlobalDefault ? (
                <span className="app-claude-connection-kind-menu-item__badge">全局默认</span>
              ) : null}
            </span>
            <span className="app-claude-connection-kind-menu-item__desc">{itemMeta.description}</span>
          </div>
        </div>
      ),
    };
  });
}

export function ClaudeConnectionKindPickerSection({
  connectionKind,
  defaultConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  onConnectionKindChange,
}: PickerSectionProps) {
  const kind = resolveSessionConnectionKind(connectionKind, defaultConnectionKind);
  const hasTabOverride = isTabConnectionKindOverride(connectionKind);

  const menuItems = useMemo(
    () => buildConnectionKindMenuItems(kind, defaultConnectionKind),
    [defaultConnectionKind, kind],
  );

  return (
    <>
      <div className="app-claude-connection-kind-dropdown-header">
        <span className="app-claude-connection-kind-dropdown-header-title">连接方式</span>
        <span className="app-claude-connection-kind-dropdown-header-subtitle">
          选择 Claude 会话长驻或逐轮处理
        </span>
      </div>
      <Menu
        className="app-composer-runtime-settings-menu"
        items={menuItems}
        selectable
        selectedKeys={[kind]}
        onClick={({ key }) => {
          const next = key === "streaming" || key === "oneshot" ? key : kind;
          if (next !== kind || hasTabOverride) onConnectionKindChange?.(next);
        }}
      />
    </>
  );
}

export function ClaudeConnectionKindChip({
  connectionKind,
  defaultConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  onConnectionKindChange,
  disabled = false,
  className,
}: ChipProps) {
  const hasTabOverride = isTabConnectionKindOverride(connectionKind);
  const kind = resolveSessionConnectionKind(connectionKind, defaultConnectionKind);
  const meta = CLAUDE_CONNECTION_KIND_LABELS[kind];
  const interactive = Boolean(onConnectionKindChange) && !disabled;
  const defaultMeta = CLAUDE_CONNECTION_KIND_LABELS[defaultConnectionKind];

  const menuItems = useMemo(
    () => buildConnectionKindMenuItems(kind, defaultConnectionKind),
    [defaultConnectionKind, kind],
  );

  const chipTooltip = hasTabOverride
    ? `本标签已临时设为${meta.title}；选「${defaultMeta.title}」可恢复跟随全局默认`
    : `跟随全局默认（${defaultMeta.title}）；点击可为本标签临时切换`;

  const chip = (
    <span
      className={`app-claude-connection-kind-chip${
        interactive ? " app-claude-connection-kind-chip--interactive" : ""
      }${hasTabOverride ? " app-claude-connection-kind-chip--override" : ""}${className ? ` ${className}` : ""}`}
      aria-label={`连接方式：${meta.title}${hasTabOverride ? "（本标签临时）" : "（全局默认）"}`}
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
      <Tooltip title={chipTooltip} placement="top">
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
          const next = key === "streaming" || key === "oneshot" 
            ? key
            : kind;
          if (next !== kind || hasTabOverride) onConnectionKindChange?.(next);
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
      dropdownRender={(menu) => (
        <div className="app-claude-connection-kind-dropdown-container">
          <div className="app-claude-connection-kind-dropdown-header">
            <span className="app-claude-connection-kind-dropdown-header-title">连接方式</span>
            <span className="app-claude-connection-kind-dropdown-header-subtitle">
              选择 Claude 会话长驻或逐轮处理
            </span>
          </div>
          {menu}
        </div>
      )}
    >
      <Tooltip title={chipTooltip} placement="top">
        <button type="button" className="app-claude-connection-kind-chip-btn">
          {chip}
        </button>
      </Tooltip>
    </Dropdown>
  );
}
