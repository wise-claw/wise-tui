import { Dropdown, Tooltip, type MenuProps } from "antd";
import { useState } from "react";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";

interface Props {
  engine: SessionExecutionEngine;
  codexAvailable?: boolean;
  onEngineChange?: (engine: SessionExecutionEngine) => void;
  /** Codex 未就绪时跳转到配置中心「执行环境」并触发探测 */
  onOpenExecutionEnvironment?: () => void;
  disabled?: boolean;
  className?: string;
}

export function SessionExecutionEngineChip({
  engine,
  codexAvailable = true,
  onEngineChange,
  onOpenExecutionEnvironment,
  disabled = false,
  className,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = SESSION_EXECUTION_ENGINE_LABELS[engine];
  const interactive = Boolean(onEngineChange) && !disabled;

  const menuItems: MenuProps["items"] = (["claude", "codex"] as const).map((key) => {
    const itemMeta = SESSION_EXECUTION_ENGINE_LABELS[key];
    const itemDisabled = key === "codex" && !codexAvailable;
    const isSelected = engine === key;

    const codexProbeAction =
      key === "codex" && itemDisabled && onOpenExecutionEnvironment ? (
        <button
          type="button"
          className="app-claude-connection-kind-menu-item__probe"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen(false);
            onOpenExecutionEnvironment();
          }}
        >
          探测
        </button>
      ) : null;

    return {
      key,
      disabled: itemDisabled,
      className: `app-claude-connection-kind-menu-item-wrapper ${isSelected ? "app-claude-connection-kind-menu-item-wrapper--selected" : ""}`,
      label: (
        <div
          className={`app-claude-connection-kind-menu-item ${
            itemDisabled ? "app-claude-connection-kind-menu-item--disabled" : ""
          } ${isSelected ? "app-claude-connection-kind-menu-item--selected" : ""}`}
        >
          <div className="app-claude-connection-kind-menu-item__icon-wrap">
            {key === "claude" ? (
              <svg className="app-claude-connection-kind-menu-item__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            ) : (
              <svg className="app-claude-connection-kind-menu-item__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            )}
          </div>
          <div className="app-claude-connection-kind-menu-item__body">
            <div className="app-claude-connection-kind-menu-item__title-row">
              <span className="app-claude-connection-kind-menu-item__title">{itemMeta.title}</span>
              {key === "claude" ? (
                <span className="app-claude-connection-kind-menu-item__badge">默认</span>
              ) : null}
              {key === "codex" && !itemDisabled ? (
                <span className="app-claude-connection-kind-menu-item__badge app-claude-connection-kind-menu-item__badge--codex">本地</span>
              ) : null}
            </div>
            <span className="app-claude-connection-kind-menu-item__desc">
              {key === "codex" && itemDisabled
                ? "未检测到 Codex CLI，点击右侧探测"
                : itemMeta.description}
            </span>
          </div>
          <div className="app-claude-connection-kind-menu-item__action-wrap">
            {codexProbeAction}
            {isSelected && !itemDisabled ? (
              <svg className="app-claude-connection-kind-menu-item__checkmark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </div>
        </div>
      ),
    };
  });

  const chipTooltip =
    engine === "codex" && !codexAvailable
      ? "未检测到 Codex CLI；可在下拉菜单中点击「探测」打开执行环境"
      : `执行引擎：${meta.title}；点击切换`;

  const chip = (
    <span
      className={`app-claude-connection-kind-chip${
        interactive ? " app-claude-connection-kind-chip--interactive" : ""
      }${engine === "codex" ? " app-claude-connection-kind-chip--override" : ""}${className ? ` ${className}` : ""}`}
      aria-label={chipTooltip}
      aria-haspopup={interactive ? "menu" : undefined}
    >
      {meta.short}
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
        selectedKeys: [engine],
        onClick: ({ key }) => {
          const next = key === "codex" || key === "claude" ? key : engine;
          if (next !== engine) onEngineChange?.(next);
          setMenuOpen(false);
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      dropdownRender={(menu) => (
        <div className="app-claude-connection-kind-dropdown-container">
          <div className="app-claude-connection-kind-dropdown-header">
            <span className="app-claude-connection-kind-dropdown-header-title">执行环境</span>
            <span className="app-claude-connection-kind-dropdown-header-subtitle">选择后台 AI 代码执行的 CLI 引擎</span>
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
