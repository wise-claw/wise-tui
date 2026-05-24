import { Dropdown, Tooltip, type MenuProps } from "antd";
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
  const meta = SESSION_EXECUTION_ENGINE_LABELS[engine];
  const interactive = Boolean(onEngineChange) && !disabled;

  const menuItems: MenuProps["items"] = (["claude", "codex"] as const).map((key) => {
    const itemMeta = SESSION_EXECUTION_ENGINE_LABELS[key];
    const itemDisabled = key === "codex" && !codexAvailable;
    const codexProbeAction =
      key === "codex" && itemDisabled && onOpenExecutionEnvironment ? (
        <button
          type="button"
          className="app-claude-connection-kind-menu-item__probe"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenExecutionEnvironment();
          }}
        >
          探测
        </button>
      ) : null;
    return {
      key,
      disabled: itemDisabled,
      label: (
        <div
          className={`app-claude-connection-kind-menu-item${
            codexProbeAction ? " app-claude-connection-kind-menu-item--with-action" : ""
          }`}
        >
          <div className="app-claude-connection-kind-menu-item__body">
            <span className="app-claude-connection-kind-menu-item__title">{itemMeta.title}</span>
            <span className="app-claude-connection-kind-menu-item__desc">
              {key === "codex" && itemDisabled
                ? "未检测到 Codex CLI，点击右侧探测"
                : itemMeta.description}
            </span>
          </div>
          {codexProbeAction}
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
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
    >
      <Tooltip title={chipTooltip} placement="top">
        <button type="button" className="app-claude-connection-kind-chip-btn">
          {chip}
        </button>
      </Tooltip>
    </Dropdown>
  );
}
