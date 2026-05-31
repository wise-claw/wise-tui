import { Dropdown, Menu, Tooltip, type MenuProps } from "antd";
import { useMemo, useState } from "react";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";

interface PickerSectionProps {
  engine: SessionExecutionEngine;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  onEngineChange?: (engine: SessionExecutionEngine) => void;
  onOpenExecutionEnvironment?: () => void;
}

interface ChipProps extends PickerSectionProps {
  disabled?: boolean;
  className?: string;
}

function isEngineAvailable(
  key: SessionExecutionEngine,
  codexAvailable: boolean,
  cursorAvailable: boolean,
): boolean {
  if (key === "codex") return codexAvailable;
  if (key === "cursor") return cursorAvailable;
  return true;
}

function unavailableDescription(
  key: SessionExecutionEngine,
): string {
  if (key === "codex") return "未检测到 Codex CLI，点击右侧探测";
  if (key === "cursor") return "Cursor SDK 未就绪，点击右侧配置 API Key";
  return SESSION_EXECUTION_ENGINE_LABELS[key].description;
}

export function buildSessionExecutionEngineMenuItems({
  engine,
  codexAvailable = true,
  cursorAvailable = true,
  onOpenExecutionEnvironment,
  onProbeClick,
}: PickerSectionProps & { onProbeClick?: () => void }): MenuProps["items"] {
  return SESSION_EXECUTION_ENGINES.map((key) => {
    const itemMeta = SESSION_EXECUTION_ENGINE_LABELS[key];
    const itemDisabled = !isEngineAvailable(key, codexAvailable, cursorAvailable);
    const isSelected = engine === key;

    const probeAction =
      itemDisabled && onOpenExecutionEnvironment && key !== "claude" ? (
        <button
          type="button"
          className="app-claude-connection-kind-menu-item__probe"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onProbeClick?.();
            onOpenExecutionEnvironment();
          }}
        >
          {key === "cursor" ? "配置" : "探测"}
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
            ) : key === "codex" ? (
              <svg className="app-claude-connection-kind-menu-item__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            ) : (
              <svg className="app-claude-connection-kind-menu-item__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
                <path d="M12 12l8-4.5" />
                <path d="M12 12v9" />
                <path d="M12 12L4 7.5" />
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
              {key === "cursor" && !itemDisabled ? (
                <span className="app-claude-connection-kind-menu-item__badge app-claude-connection-kind-menu-item__badge--cursor">SDK</span>
              ) : null}
            </div>
            <span className="app-claude-connection-kind-menu-item__desc">
              {itemDisabled ? unavailableDescription(key) : itemMeta.description}
            </span>
          </div>
          <div className="app-claude-connection-kind-menu-item__action-wrap">
            {probeAction}
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
}

export function SessionExecutionEnginePickerSection({
  engine,
  codexAvailable = true,
  cursorAvailable = true,
  onEngineChange,
  onOpenExecutionEnvironment,
}: PickerSectionProps) {
  const menuItems = useMemo(
    () =>
      buildSessionExecutionEngineMenuItems({
        engine,
        codexAvailable,
        cursorAvailable,
        onOpenExecutionEnvironment,
      }),
    [codexAvailable, cursorAvailable, engine, onOpenExecutionEnvironment],
  );

  return (
    <>
      <div className="app-claude-connection-kind-dropdown-header">
        <span className="app-claude-connection-kind-dropdown-header-title">执行环境</span>
        <span className="app-claude-connection-kind-dropdown-header-subtitle">选择后台 AI 代码执行的 CLI 引擎</span>
      </div>
      <Menu
        className="app-composer-runtime-settings-menu"
        items={menuItems}
        selectable
        selectedKeys={[engine]}
        onClick={({ key }) => {
          if (key === "codex" || key === "claude" || key === "cursor") {
            if (key !== engine) onEngineChange?.(key);
          }
        }}
      />
    </>
  );
}

export function SessionExecutionEngineChip({
  engine,
  codexAvailable = true,
  cursorAvailable = true,
  onEngineChange,
  onOpenExecutionEnvironment,
  disabled = false,
  className,
}: ChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = SESSION_EXECUTION_ENGINE_LABELS[engine];
  const interactive = Boolean(onEngineChange) && !disabled;
  const engineReady = isEngineAvailable(engine, codexAvailable, cursorAvailable);

  const menuItems = useMemo(
    () =>
      buildSessionExecutionEngineMenuItems({
        engine,
        codexAvailable,
        cursorAvailable,
        onOpenExecutionEnvironment,
        onProbeClick: () => setMenuOpen(false),
      }),
    [codexAvailable, cursorAvailable, engine, onOpenExecutionEnvironment],
  );

  const chipTooltip =
    !engineReady
      ? engine === "cursor"
        ? "Cursor SDK 未就绪；可在下拉菜单中点击「配置」"
        : "未检测到 Codex CLI；可在下拉菜单中点击「探测」"
      : `执行引擎：${meta.title}；点击切换`;

  const chip = (
    <span
      className={`app-claude-connection-kind-chip${
        interactive ? " app-claude-connection-kind-chip--interactive" : ""
      } app-claude-connection-kind-chip--${engine}${className ? ` ${className}` : ""}`}
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
      classNames={{ root: "app-claude-connection-kind-dropdown" }}
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys: [engine],
        onClick: ({ key }) => {
          if (key === "codex" || key === "claude" || key === "cursor") {
            if (key !== engine) onEngineChange?.(key);
          }
          setMenuOpen(false);
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      popupRender={(menu) => (
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
