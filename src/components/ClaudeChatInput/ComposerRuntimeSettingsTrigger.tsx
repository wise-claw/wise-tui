import { Dropdown, Tooltip, type MenuProps } from "antd";
import { useMemo, useState } from "react";
import {
  CLAUDE_CONNECTION_KIND_LABELS,
  CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  isTabConnectionKindOverride,
  resolveSessionConnectionKind,
  type ClaudeSessionConnectionKind,
} from "../../constants/claudeConnection";
import {
  normalizeSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { buildConnectionKindMenuItems } from "./ClaudeConnectionKindChip";
import { buildSessionExecutionEngineMenuItems } from "./SessionExecutionEngineChip";

interface Props {
  engine: SessionExecutionEngine;
  codexAvailable?: boolean;
  onEngineChange?: (engine: SessionExecutionEngine) => void;
  onOpenExecutionEnvironment?: () => void;
  connectionKind?: ClaudeSessionConnectionKind | null;
  defaultConnectionKind?: ClaudeSessionConnectionKind;
  onConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  disabled?: boolean;
}

function RuntimeSettingsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function isSessionExecutionEngineKey(key: string): key is SessionExecutionEngine {
  return key === "claude" || key === "codex";
}

function isConnectionKindKey(key: string): key is ClaudeSessionConnectionKind {
  return key === "streaming" || key === "oneshot";
}

export function ComposerRuntimeSettingsTrigger({
  engine: engineProp,
  codexAvailable = true,
  onEngineChange,
  onOpenExecutionEnvironment,
  connectionKind,
  defaultConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  onConnectionKindChange,
  disabled = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const engine = normalizeSessionExecutionEngine(engineProp);

  const showEngine = codexAvailable && Boolean(onEngineChange);
  const showConnection = engine === "claude" && Boolean(onConnectionKindChange);

  const resolvedConnectionKind = resolveSessionConnectionKind(connectionKind, defaultConnectionKind);
  const hasConnectionOverride = isTabConnectionKindOverride(connectionKind);
  const hasActiveOverride = engine === "codex" || hasConnectionOverride;

  const tooltip = useMemo(() => {
    const parts: string[] = [];
    if (showEngine) {
      parts.push(`执行引擎：${SESSION_EXECUTION_ENGINE_LABELS[engine].title}`);
    }
    if (showConnection) {
      parts.push(`连接方式：${CLAUDE_CONNECTION_KIND_LABELS[resolvedConnectionKind].title}`);
    }
    return parts.length > 0 ? `${parts.join(" · ")}；点击配置` : "运行时配置";
  }, [engine, resolvedConnectionKind, showConnection, showEngine]);

  const menuItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];

    if (showEngine) {
      const engineItems = buildSessionExecutionEngineMenuItems({
        engine,
        codexAvailable,
        onOpenExecutionEnvironment,
        onProbeClick: () => setMenuOpen(false),
      });
      if (engineItems?.length) {
        items.push({
          type: "group",
          label: "执行环境",
          children: engineItems,
        });
      }
    }

    if (showConnection) {
      const connectionItems = buildConnectionKindMenuItems(
        resolvedConnectionKind,
        defaultConnectionKind,
      );
      if (connectionItems?.length) {
        items.push({
          type: "group",
          label: "连接方式",
          children: connectionItems,
        });
      }
    }

    return items;
  }, [
    codexAvailable,
    defaultConnectionKind,
    engine,
    onOpenExecutionEnvironment,
    resolvedConnectionKind,
    showConnection,
    showEngine,
  ]);

  const selectedKeys = useMemo(() => {
    const keys: string[] = [];
    if (showEngine) keys.push(engine);
    if (showConnection) keys.push(resolvedConnectionKind);
    return keys;
  }, [engine, resolvedConnectionKind, showConnection, showEngine]);

  if (!showEngine && !showConnection) {
    return null;
  }

  if (!menuItems?.length) {
    return null;
  }

  return (
    <Dropdown
      classNames={{ root: "app-claude-connection-kind-dropdown app-composer-runtime-settings-dropdown" }}
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys,
        onClick: ({ key }) => {
          if (typeof key !== "string") return;
          if (isSessionExecutionEngineKey(key)) {
            if (key !== engine) {
              onEngineChange?.(key);
              setMenuOpen(false);
            }
            return;
          }
          if (isConnectionKindKey(key)) {
            if (key !== resolvedConnectionKind || hasConnectionOverride) {
              onConnectionKindChange?.(key);
            }
          }
        },
      }}
      trigger={["click"]}
      placement="top"
      disabled={disabled}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      popupRender={(menu) => (
        <div className="app-claude-connection-kind-dropdown-container app-composer-runtime-settings-popover">
          {menu ?? null}
        </div>
      )}
    >
      <Tooltip title={tooltip} placement="top" open={menuOpen ? false : undefined}>
        <button
          type="button"
          className={`app-composer-runtime-settings-btn${
            hasActiveOverride ? " app-composer-runtime-settings-btn--active" : ""
          }`}
          aria-label={tooltip}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled}
        >
          <RuntimeSettingsIcon />
        </button>
      </Tooltip>
    </Dropdown>
  );
}
