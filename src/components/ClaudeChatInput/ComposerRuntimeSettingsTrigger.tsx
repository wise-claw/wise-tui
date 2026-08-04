import { Dropdown, type MenuProps } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { memo, useMemo, useState } from "react";
import {
  CLAUDE_CONNECTION_KIND_LABELS,
  CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  isTabConnectionKindOverride,
  resolveSessionConnectionKind,
  type ClaudeSessionConnectionKind,
} from "../../constants/claudeConnection";
import {
  isSessionExecutionEngine,
  normalizeSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import { buildConnectionKindMenuItems } from "./ClaudeConnectionKindChip";
import { ExecutionEnvironmentDropdownHeader } from "./ExecutionEnvironmentDropdownHeader";
import { buildSessionExecutionEngineMenuItems } from "./SessionExecutionEngineChip";
import {
  applyPaneRuntimePreset,
  buildPaneRuntimePresetMenuItems,
  isPaneRuntimePresetKey,
  resolvePaneRuntimePresetLabel,
} from "./composerPaneRuntimePresetMenu";
import {
  isPaneExtraExecutionEngine,
  PANE_EXTRA_EXECUTION_ENGINES,
  resolvePaneEffectiveEngine,
  resolvePaneExecutionEnvironmentMenuSelection,
  resolvePaneRuntimePreset,
  type PaneRuntimeOverride,
  type PaneRuntimePreset,
} from "../../types/paneRuntimeOverride";
import { useComposerActiveProxyRoute } from "../../hooks/useComposerActiveProxyRoute";

interface Props {
  engine: SessionExecutionEngine;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
  onEngineChange?: (engine: SessionExecutionEngine) => void;
  onOpenExecutionEnvironment?: () => void;
  connectionKind?: ClaudeSessionConnectionKind | null;
  defaultConnectionKind?: ClaudeSessionConnectionKind;
  onConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  disabled?: boolean;
  /** 多屏窗格 Claude 代理路由；bypass 时不展示代理角标。 */
  claudeProxyRoute?: "auto" | "bypass";
  /** 多屏窗格：将 Claude 直连 / 代理 / Codex 并入本弹窗「执行环境」区。 */
  paneIndex?: number;
  paneRuntimeOverride?: PaneRuntimeOverride | null;
  onUpdatePaneRuntimeOverride?: (
    paneIndex: number,
    patch: Partial<PaneRuntimeOverride>,
  ) => void;
  /** 右栏紧凑模式：只渲染图标，去掉执行引擎文字标签与代理角标。 */
  iconOnly?: boolean;
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
  return isSessionExecutionEngine(key);
}

function isConnectionKindKey(key: string): key is ClaudeSessionConnectionKind {
  return key === "streaming" || key === "oneshot";
}

function ComposerRuntimeSettingsTriggerImpl({
  engine: engineProp,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
  qoderAvailable = false,
  onEngineChange,
  onOpenExecutionEnvironment,
  connectionKind,
  defaultConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  onConnectionKindChange,
  disabled = false,
  claudeProxyRoute,
  paneIndex = 0,
  paneRuntimeOverride = null,
  onUpdatePaneRuntimeOverride,
  iconOnly = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const engine = normalizeSessionExecutionEngine(engineProp);
  const showPaneRuntimePresets = Boolean(onUpdatePaneRuntimeOverride);
  const activePanePreset = showPaneRuntimePresets
    ? resolvePaneRuntimePreset(paneRuntimeOverride, engine)
    : null;
  const effectiveEngine = showPaneRuntimePresets
    ? resolvePaneEffectiveEngine(paneRuntimeOverride, engine)
    : engine;

  const activeProxyRoute = useComposerActiveProxyRoute(effectiveEngine, {
    claudeProxyBypass: claudeProxyRoute === "bypass",
  });

  // 多屏 pane 无显式 override（或仅 claude/codex）时，根据生效引擎与代理路由推断默认选中预设，
  // 确保继承默认的 pane 也能在菜单中高亮当前预设（claude-direct / claude-proxy / codex）。
  // 当 route=auto 时，检查是否真有代理活跃；无代理则退回到直连，避免无代理时仍选中「代理」项。
  // Codex RPC / Cursor 等额外引擎绝不推断为 Claude/Codex 预设，否则会与下方勾选项双高亮。
  const inferredPanePreset = useMemo<PaneRuntimePreset | null>(() => {
    if (!showPaneRuntimePresets) return null;
    if (activePanePreset) return activePanePreset;
    const overrideEngine = paneRuntimeOverride?.executionEngine;
    const effectiveOverrideEngine = overrideEngine ?? effectiveEngine;
    if (isPaneExtraExecutionEngine(effectiveOverrideEngine)) {
      return null;
    }
    if (effectiveOverrideEngine === "codex") return "codex";
    const route = paneRuntimeOverride?.claudeProxyRoute ?? claudeProxyRoute ?? "auto";
    if (route === "bypass") return "claude-direct";
    return activeProxyRoute ? "claude-proxy" : "claude-direct";
  }, [showPaneRuntimePresets, activePanePreset, paneRuntimeOverride, effectiveEngine, claudeProxyRoute, activeProxyRoute]);

  const paneMenuSelection = useMemo(() => {
    if (!showPaneRuntimePresets) {
      return {
        selectedKeys: [] as string[],
        highlightPreset: null as PaneRuntimePreset | null,
        highlightExtraEngine: null as SessionExecutionEngine | null,
      };
    }
    return resolvePaneExecutionEnvironmentMenuSelection({
      override: paneRuntimeOverride,
      fallbackEngine: engine,
      inferredPreset: inferredPanePreset,
    });
  }, [showPaneRuntimePresets, paneRuntimeOverride, engine, inferredPanePreset]);

  const showExtraPaneEngines =
    showPaneRuntimePresets &&
    (codexAvailable || cursorAvailable || geminiAvailable || opencodeAvailable || qoderAvailable);
  const showEngine =
    !showPaneRuntimePresets &&
    (codexAvailable || cursorAvailable || geminiAvailable || opencodeAvailable || qoderAvailable) &&
    Boolean(onEngineChange);
  // Claude Code 统一走长驻会话（全局默认 streaming）；Composer 执行环境菜单不再展示连接方式切换。
  const showConnection = false;

  const resolvedConnectionKind = resolveSessionConnectionKind(connectionKind, defaultConnectionKind);
  const hasConnectionOverride = isTabConnectionKindOverride(connectionKind);
  const hasActiveOverride =
    effectiveEngine === "codex" ||
    effectiveEngine === "cursor" ||
    effectiveEngine === "gemini" ||
    effectiveEngine === "opencode" ||
    effectiveEngine === "qoder" ||
    (showPaneRuntimePresets &&
      (activePanePreset === "claude-proxy" ||
        activePanePreset === "codex" ||
        isPaneExtraExecutionEngine(effectiveEngine)));
  const tooltip = useMemo(() => {
    const parts: string[] = [];
    if (showPaneRuntimePresets) {
      parts.push(`执行环境：${resolvePaneRuntimePresetLabel(paneRuntimeOverride, engine)}`);
    } else if (showEngine) {
      parts.push(`执行引擎：${SESSION_EXECUTION_ENGINE_LABELS[engine].title}`);
    }
    if (activeProxyRoute) {
      parts.push(`路由：${activeProxyRoute.label}`);
      parts.push(activeProxyRoute.detail);
      if (activeProxyRoute.attentionMessage) {
        parts.push(activeProxyRoute.attentionMessage);
      }
    }
    if (showConnection) {
      parts.push(`连接方式：${CLAUDE_CONNECTION_KIND_LABELS[resolvedConnectionKind].title}`);
    }
    return parts.length > 0 ? `${parts.join(" · ")}；点击配置` : "运行时配置";
  }, [
    activeProxyRoute,
    engine,
    paneRuntimeOverride,
    resolvedConnectionKind,
    showConnection,
    showEngine,
    showPaneRuntimePresets,
  ]);

  const menuItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];

    if (showPaneRuntimePresets) {
      const presetItems = buildPaneRuntimePresetMenuItems(
        paneMenuSelection.highlightPreset,
        null,
        { codexAvailable },
      );
      if (presetItems?.length) {
        items.push(...presetItems);
      }
      if (showExtraPaneEngines) {
        const extraEngineItems = buildSessionExecutionEngineMenuItems({
          // 仅额外引擎生效时勾选；预设生效时传 claude 哨兵，避免误勾 Codex RPC 等项
          engine: paneMenuSelection.highlightExtraEngine ?? "claude",
          codexAvailable,
          cursorAvailable,
          geminiAvailable,
          opencodeAvailable,
          qoderAvailable,
          engines: PANE_EXTRA_EXECUTION_ENGINES,
        });
        if (extraEngineItems?.length) {
          if (items.length > 0) {
            items.push({ type: "divider" });
          }
          items.push(...extraEngineItems);
        }
      }
    } else if (showEngine) {
      const engineItems = buildSessionExecutionEngineMenuItems({
        engine,
        codexAvailable,
        cursorAvailable,
        geminiAvailable,
        opencodeAvailable,
        qoderAvailable,
      });
      if (engineItems?.length) {
        items.push(...engineItems);
      }
    }

    if (showConnection) {
      const connectionItems = buildConnectionKindMenuItems(
        resolvedConnectionKind,
        defaultConnectionKind,
      );
      if (connectionItems?.length) {
        if (items.length > 0) {
          items.push({ type: "divider" });
        }
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
    cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
    qoderAvailable,
    defaultConnectionKind,
    engine,
    paneMenuSelection.highlightExtraEngine,
    paneMenuSelection.highlightPreset,
    onOpenExecutionEnvironment,
    resolvedConnectionKind,
    showConnection,
    showEngine,
    showExtraPaneEngines,
    showPaneRuntimePresets,
  ]);

  const selectedKeys = useMemo(() => {
    const keys: string[] = [];
    if (showPaneRuntimePresets) {
      keys.push(...paneMenuSelection.selectedKeys);
    } else if (showEngine) {
      keys.push(engine);
    }
    if (showConnection) keys.push(resolvedConnectionKind);
    return keys;
  }, [
    paneMenuSelection.selectedKeys,
    showConnection,
    showEngine,
    showPaneRuntimePresets,
    engine,
    resolvedConnectionKind,
  ]);

  if (!showEngine && !showConnection && !showPaneRuntimePresets) {
    return null;
  }

  if (!menuItems?.length) {
    return null;
  }

  const triggerLabel = iconOnly
    ? null
    : showPaneRuntimePresets
      ? resolvePaneRuntimePresetLabel(paneRuntimeOverride, engine)
      : showEngine
        ? SESSION_EXECUTION_ENGINE_LABELS[engine].title
        : null;
  // iconOnly 模式下连代理角标也隐藏：右栏空间窄，tooltip 已经能告诉用户当前路由。
  const showProxyBadge =
    !iconOnly &&
    Boolean(activeProxyRoute) &&
    !(showPaneRuntimePresets && activePanePreset === "claude-proxy");

  return (
    <Dropdown
      classNames={{ root: "app-claude-connection-kind-dropdown app-composer-runtime-settings-dropdown" }}
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys,
        onClick: ({ key }) => {
          if (typeof key !== "string") return;
          if (showPaneRuntimePresets && isPaneRuntimePresetKey(key)) {
            if (key !== activePanePreset && onUpdatePaneRuntimeOverride) {
              applyPaneRuntimePreset(paneIndex, key, onUpdatePaneRuntimeOverride);
            }
            return;
          }
          if (isSessionExecutionEngineKey(key)) {
            if (showPaneRuntimePresets && onUpdatePaneRuntimeOverride) {
              if (key !== effectiveEngine) {
                onUpdatePaneRuntimeOverride(paneIndex, { executionEngine: key });
              }
              return;
            }
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
          {showEngine || showPaneRuntimePresets ? (
            <ExecutionEnvironmentDropdownHeader
              showSubtitle={false}
              onOpenConfig={
                onOpenExecutionEnvironment
                  ? () => {
                      setMenuOpen(false);
                      onOpenExecutionEnvironment();
                    }
                  : undefined
              }
            />
          ) : null}
          {menu ?? null}
        </div>
      )}
    >
      <HoverHint title={tooltip} placement="top" open={menuOpen ? false : undefined}>
        <button
          type="button"
          className={`app-composer-runtime-settings-btn${
            hasActiveOverride ? " app-composer-runtime-settings-btn--active" : ""
          }${triggerLabel ? " app-composer-runtime-settings-btn--with-engine" : ""}${
            showProxyBadge ? " app-composer-runtime-settings-btn--proxy-route" : ""
          }`}
          aria-label={tooltip}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled}
        >
          <RuntimeSettingsIcon />
          {triggerLabel ? (
            <span className="app-composer-runtime-settings-btn__engine-label">{triggerLabel}</span>
          ) : null}
          {showProxyBadge ? (
            <span className="app-composer-runtime-settings-btn__proxy-badge" aria-hidden>
              代理
            </span>
          ) : null}
        </button>
      </HoverHint>
    </Dropdown>
  );
}
// React.memo：Semi AIChatInput 每 transaction setState 会重渲染整棵子树；props 引用稳定时叶子 bail out，避免底栏组件每键 reconcile。
const MemoizedComposerRuntimeSettingsTrigger = memo(ComposerRuntimeSettingsTriggerImpl);
MemoizedComposerRuntimeSettingsTrigger.displayName = "ComposerRuntimeSettingsTrigger";
export const ComposerRuntimeSettingsTrigger = MemoizedComposerRuntimeSettingsTrigger;
