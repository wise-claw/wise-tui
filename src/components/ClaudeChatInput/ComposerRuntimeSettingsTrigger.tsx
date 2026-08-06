import { Dropdown, type MenuProps } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { memo, useEffect, useMemo, useState } from "react";
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
  mergePaneRuntimeOverride,
  PANE_EXTRA_EXECUTION_ENGINES,
  paneRuntimePresetToOverride,
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
  /** 多屏窗格：将 Claude 直连 / 代理预设并入本弹窗「执行环境」区。 */
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
  /**
   * 乐观引擎：单屏路径靠 live-store structureKey 才能把 session.executionEngine 灌回 Composer；
   * 结构指纹漏字段或 rAF 延迟时，按钮文案会短暂（或一直）停在旧值。本地先切，prop 追上后清掉。
   */
  const [optimisticEngine, setOptimisticEngine] = useState<SessionExecutionEngine | null>(null);
  const [optimisticPaneOverride, setOptimisticPaneOverride] = useState<PaneRuntimeOverride | null>(
    null,
  );
  const engineFromProp = normalizeSessionExecutionEngine(engineProp);
  const engine = optimisticEngine ?? engineFromProp;
  const resolvedPaneOverride = optimisticPaneOverride ?? paneRuntimeOverride;
  useEffect(() => {
    if (optimisticEngine != null && engineFromProp === optimisticEngine) {
      setOptimisticEngine(null);
    }
  }, [engineFromProp, optimisticEngine]);
  useEffect(() => {
    if (!optimisticPaneOverride) return;
    if (
      (paneRuntimeOverride?.executionEngine ?? null) ===
        (optimisticPaneOverride.executionEngine ?? null) &&
      (paneRuntimeOverride?.claudeProxyRoute ?? null) ===
        (optimisticPaneOverride.claudeProxyRoute ?? null)
    ) {
      setOptimisticPaneOverride(null);
    }
  }, [paneRuntimeOverride, optimisticPaneOverride]);
  const showPaneRuntimePresets = Boolean(onUpdatePaneRuntimeOverride);
  const activePanePreset = showPaneRuntimePresets
    ? resolvePaneRuntimePreset(resolvedPaneOverride, engine)
    : null;
  const effectiveEngine = showPaneRuntimePresets
    ? resolvePaneEffectiveEngine(resolvedPaneOverride, engine)
    : engine;

  const activeProxyRoute = useComposerActiveProxyRoute(effectiveEngine, {
    claudeProxyBypass:
      (resolvedPaneOverride?.claudeProxyRoute ?? claudeProxyRoute) === "bypass",
  });

  // 多屏 pane 无显式 override 时，根据生效引擎与代理路由推断默认选中预设，
  // 确保继承默认的 pane 也能在菜单中高亮当前预设（claude-direct / claude-proxy）。
  // 当 route=auto 时，检查是否真有代理活跃；无代理则退回到直连，避免无代理时仍选中「代理」项。
  // Codex RPC / Cursor 等额外引擎绝不推断为 Claude 预设，否则会与下方勾选项双高亮。
  const inferredPanePreset = useMemo<PaneRuntimePreset | null>(() => {
    if (!showPaneRuntimePresets) return null;
    if (activePanePreset) return activePanePreset;
    const overrideEngine = resolvedPaneOverride?.executionEngine;
    const effectiveOverrideEngine = overrideEngine ?? effectiveEngine;
    if (isPaneExtraExecutionEngine(effectiveOverrideEngine)) {
      return null;
    }
    const route =
      resolvedPaneOverride?.claudeProxyRoute ?? claudeProxyRoute ?? "auto";
    if (route === "bypass") return "claude-direct";
    return activeProxyRoute ? "claude-proxy" : "claude-direct";
  }, [
    showPaneRuntimePresets,
    activePanePreset,
    resolvedPaneOverride,
    effectiveEngine,
    claudeProxyRoute,
    activeProxyRoute,
  ]);

  const paneMenuSelection = useMemo(() => {
    if (!showPaneRuntimePresets) {
      return {
        selectedKeys: [] as string[],
        highlightPreset: null as PaneRuntimePreset | null,
        highlightExtraEngine: null as SessionExecutionEngine | null,
      };
    }
    return resolvePaneExecutionEnvironmentMenuSelection({
      override: resolvedPaneOverride,
      fallbackEngine: engine,
      inferredPreset: inferredPanePreset,
    });
  }, [showPaneRuntimePresets, resolvedPaneOverride, engine, inferredPanePreset]);

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
        isPaneExtraExecutionEngine(effectiveEngine)));
  const tooltip = useMemo(() => {
    const parts: string[] = [];
    if (showPaneRuntimePresets) {
      parts.push(`执行环境：${resolvePaneRuntimePresetLabel(resolvedPaneOverride, engine)}`);
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
    resolvedPaneOverride,
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
      ? resolvePaneRuntimePresetLabel(resolvedPaneOverride, engine)
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
              const nextOverride = paneRuntimePresetToOverride(key);
              setOptimisticPaneOverride(nextOverride);
              setOptimisticEngine(nextOverride.executionEngine ?? null);
              applyPaneRuntimePreset(paneIndex, key, onUpdatePaneRuntimeOverride);
            }
            return;
          }
          if (isSessionExecutionEngineKey(key)) {
            if (showPaneRuntimePresets && onUpdatePaneRuntimeOverride) {
              if (key !== effectiveEngine) {
                const nextOverride = mergePaneRuntimeOverride(resolvedPaneOverride, {
                  executionEngine: key,
                });
                setOptimisticPaneOverride(nextOverride);
                setOptimisticEngine(key);
                onUpdatePaneRuntimeOverride(paneIndex, { executionEngine: key });
              }
              return;
            }
            if (key !== engine) {
              setOptimisticEngine(key);
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
