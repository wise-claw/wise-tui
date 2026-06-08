/**
 * 工作台「默认配置」：统一写入 SQLite `app_settings`（`wise.defaultConfig.v1` JSON）。
 * 首次加载会从 legacy 分键与 `localStorage` 一次性迁入并清除旧副本。
 */
import type { ClaudeSession } from "../types";
import {
  DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES,
  normalizeLeftSidebarHubQuickEntries,
  type LeftSidebarHubQuickEntryId,
} from "../constants/leftSidebarHubQuickEntries";
import {
  decodeAtMentionDefaultSelectValue,
  DEFAULT_AT_MENTION_DEFAULT_TARGET,
  encodeAtMentionDefaultSelectValue,
  normalizeAtMentionDefaultTarget,
  type AtMentionDefaultTarget,
} from "../constants/atMentionDefault";
import {
  DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS,
  normalizeExecutionEnvironmentDispatchHistoryDays,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../constants/executionEnvironmentDispatch";
import {
  normalizeComposerCommonPhrases,
  type ComposerCommonPhrase,
} from "../constants/composerCommonPhrase";
import { normalizeChord } from "../utils/atMentionShortcutChord";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK, RIGHT_PANEL_DEFAULT_COLLAPSED_KEY } from "../utils/rightPanelStorage";
import { deleteAppSetting, getAppSetting, setAppSetting, setAppSettingJson } from "./appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const WISE_DEFAULT_CONFIG_KEY = "wise.defaultConfig.v1";

/** 一次性：产品默认由逐轮改为长驻后，将已持久化的 `oneshot` 升为 `streaming`。 */
export const WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY =
  "wise.defaultConfig.oneshotToStreaming.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY = "wise.rightPanel.defaultCollapsed.v1";

export const CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK: ClaudeSessionConnectionKind = "streaming";

export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

export const WISE_RIGHT_PANEL_DEFAULT_CHANGED = "wise:right-panel-default-changed";

export const WISE_TOPBAR_CHROME_DEFAULT_CHANGED = "wise:topbar-chrome-default-changed";

export const WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED = "wise:left-sidebar-hub-quick-entries-changed";

export const WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED = "wise:left-sidebar-monitor-panel-changed";

export const WISE_MONITOR_PANEL_PLACEMENT_CHANGED = "wise:monitor-panel-placement-changed";

export const WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED =
  "wise:execution-environment-dispatch-history-days-changed";

export const WISE_AT_MENTION_DEFAULT_CHANGED = "wise:at-mention-default-changed";

export const WISE_AT_MENTION_SHORTCUTS_CHANGED = "wise:at-mention-shortcuts-changed";

export const WISE_COMPOSER_COMMON_PHRASES_CHANGED = "wise:composer-common-phrases-changed";

export const WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED = "wise:workspace-inspector-panels-changed";

export const WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED = "wise:file-tree-open-in-new-pane-changed";

export const WISE_REPO_PANEL_PLACEMENT_CHANGED = "wise:repo-panel-placement-changed";

export type MonitorPanelPlacement = "left" | "right";

export type WorkspaceInspectorPanelsDefaults = Pick<
  WiseDefaultConfigV1,
  | "showWorkspaceQuickActionsPanel"
  | "showWorkspaceMemosPanel"
  | "showWorkspaceTodosPanel"
>;

export interface WiseDefaultConfigV1 {
  version: 1;
  connectionKind: ClaudeSessionConnectionKind;
  rightPanelDefaultCollapsed: boolean;
  /** 主会话顶栏 LLM 代理图标；默认隐藏。 */
  showLlmProxyTopbar: boolean;
  /** 主会话顶栏 Free Claude Code 图标；默认隐藏。 */
  showFccTopbar: boolean;
  /** 主会话顶栏 FCC 请求流量图标；默认隐藏。 */
  showFccTrafficTopbar: boolean;
  /** 主会话顶栏全链路分析图标；默认隐藏。 */
  showSessionDataLinkTopbar: boolean;
  /** 左栏 AI 工作台快捷入口；默认 MCP、技能、自动化。 */
  leftSidebarHubQuickEntries: LeftSidebarHubQuickEntryId[];
  /** 运行面板（终端 / 工作流运行态）是否显示；默认显示。 */
  showLeftSidebarMonitorPanel: boolean;
  /** 运行面板默认栏位；默认左栏。 */
  monitorPanelPlacement: MonitorPanelPlacement;
  /** 左栏「任务派发」默认查询近 N 天历史；默认 1 天。 */
  executionEnvironmentDispatchHistoryDays: ExecutionEnvironmentDispatchHistoryDays;
  /** 主会话 @ 空查询打开时默认高亮的执行环境或终端。 */
  atMentionDefaultTarget: AtMentionDefaultTarget;
  /** `encodeAtMentionDefaultSelectValue` → chord（如 `Mod+Shift+Digit2`）。 */
  atMentionShortcutByTarget: Record<string, string>;
  /** 主会话常用语：快捷键发送或点击按钮发送。 */
  composerCommonPhrases: ComposerCommonPhrase[];
  /** 右栏工作区快捷操作卡片；默认显示。 */
  showWorkspaceQuickActionsPanel: boolean;
  /** 右栏备忘录卡片；默认显示。 */
  showWorkspaceMemosPanel: boolean;
  /** 右栏待办事项卡片；默认显示。 */
  showWorkspaceTodosPanel: boolean;
  /** 文件树点击文件时在新窗格打开，而非占用当前会话主区。 */
  fileTreeOpenInNewPane: boolean;
  /** Git 变更面板默认栏位；默认左栏。 */
  gitPanelPlacement: MonitorPanelPlacement;
  /** 仓库文件树默认栏位；默认左栏（与 Git 同在左栏时 Tab 切换）。 */
  filesPanelPlacement: MonitorPanelPlacement;
}

const DEFAULT_CONFIG: WiseDefaultConfigV1 = {
  version: 1,
  connectionKind: CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  rightPanelDefaultCollapsed: RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  showLlmProxyTopbar: false,
  showFccTopbar: false,
  showFccTrafficTopbar: false,
  showSessionDataLinkTopbar: false,
  leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
  showLeftSidebarMonitorPanel: true,
  monitorPanelPlacement: "left",
  executionEnvironmentDispatchHistoryDays: DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS,
  atMentionDefaultTarget: DEFAULT_AT_MENTION_DEFAULT_TARGET,
  atMentionShortcutByTarget: {},
  composerCommonPhrases: [],
  showWorkspaceQuickActionsPanel: true,
  showWorkspaceMemosPanel: true,
  showWorkspaceTodosPanel: true,
  fileTreeOpenInNewPane: false,
  gitPanelPlacement: "left",
  filesPanelPlacement: "left",
};

function normalizeMonitorPanelPlacement(raw: unknown): MonitorPanelPlacement | null {
  return raw === "left" || raw === "right" ? raw : null;
}

function normalizeBoolean(raw: unknown, fallback = false): boolean {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return fallback;
}

function normalizeConnectionKind(raw: unknown): ClaudeSessionConnectionKind | null {
  return raw === "streaming" || raw === "oneshot" ? raw : null;
}

function normalizeAtMentionShortcutByTarget(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const targetKey = key.trim();
    if (!targetKey || typeof value !== "string") continue;
    const chord = normalizeChord(value);
    if (chord) out[targetKey] = chord;
  }
  return out;
}

function normalizeRightPanelCollapsed(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return null;
}

function parseConfigJson(raw: string | null | undefined): WiseDefaultConfigV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WiseDefaultConfigV1>;
    const connectionKind = normalizeConnectionKind(parsed.connectionKind);
    const rightPanelDefaultCollapsed = normalizeRightPanelCollapsed(parsed.rightPanelDefaultCollapsed);
    if (connectionKind === null || rightPanelDefaultCollapsed === null) return null;
    return {
      version: 1,
      connectionKind,
      rightPanelDefaultCollapsed,
      showLlmProxyTopbar: normalizeBoolean(parsed.showLlmProxyTopbar),
      showFccTopbar:
        parsed.showFccTopbar === undefined
          ? DEFAULT_CONFIG.showFccTopbar
          : normalizeBoolean(parsed.showFccTopbar),
      showFccTrafficTopbar: normalizeBoolean(parsed.showFccTrafficTopbar),
      showSessionDataLinkTopbar: normalizeBoolean(parsed.showSessionDataLinkTopbar),
      leftSidebarHubQuickEntries: normalizeLeftSidebarHubQuickEntries(parsed.leftSidebarHubQuickEntries),
      showLeftSidebarMonitorPanel:
        parsed.showLeftSidebarMonitorPanel === undefined
          ? DEFAULT_CONFIG.showLeftSidebarMonitorPanel
          : normalizeBoolean(parsed.showLeftSidebarMonitorPanel, DEFAULT_CONFIG.showLeftSidebarMonitorPanel),
      monitorPanelPlacement:
        normalizeMonitorPanelPlacement(parsed.monitorPanelPlacement) ??
        DEFAULT_CONFIG.monitorPanelPlacement,
      executionEnvironmentDispatchHistoryDays:
        parsed.executionEnvironmentDispatchHistoryDays === undefined
          ? DEFAULT_CONFIG.executionEnvironmentDispatchHistoryDays
          : normalizeExecutionEnvironmentDispatchHistoryDays(parsed.executionEnvironmentDispatchHistoryDays),
      atMentionDefaultTarget:
        parsed.atMentionDefaultTarget === undefined
          ? DEFAULT_CONFIG.atMentionDefaultTarget
          : normalizeAtMentionDefaultTarget(parsed.atMentionDefaultTarget),
      atMentionShortcutByTarget:
        parsed.atMentionShortcutByTarget === undefined
          ? DEFAULT_CONFIG.atMentionShortcutByTarget
          : normalizeAtMentionShortcutByTarget(parsed.atMentionShortcutByTarget),
      composerCommonPhrases:
        parsed.composerCommonPhrases === undefined
          ? DEFAULT_CONFIG.composerCommonPhrases
          : normalizeComposerCommonPhrases(parsed.composerCommonPhrases),
      showWorkspaceQuickActionsPanel:
        parsed.showWorkspaceQuickActionsPanel === undefined
          ? DEFAULT_CONFIG.showWorkspaceQuickActionsPanel
          : normalizeBoolean(
              parsed.showWorkspaceQuickActionsPanel,
              DEFAULT_CONFIG.showWorkspaceQuickActionsPanel,
            ),
      showWorkspaceMemosPanel:
        parsed.showWorkspaceMemosPanel === undefined
          ? DEFAULT_CONFIG.showWorkspaceMemosPanel
          : normalizeBoolean(parsed.showWorkspaceMemosPanel, DEFAULT_CONFIG.showWorkspaceMemosPanel),
      showWorkspaceTodosPanel:
        parsed.showWorkspaceTodosPanel === undefined
          ? DEFAULT_CONFIG.showWorkspaceTodosPanel
          : normalizeBoolean(parsed.showWorkspaceTodosPanel, DEFAULT_CONFIG.showWorkspaceTodosPanel),
      fileTreeOpenInNewPane:
        parsed.fileTreeOpenInNewPane === undefined
          ? DEFAULT_CONFIG.fileTreeOpenInNewPane
          : normalizeBoolean(parsed.fileTreeOpenInNewPane, DEFAULT_CONFIG.fileTreeOpenInNewPane),
      gitPanelPlacement:
        normalizeMonitorPanelPlacement(parsed.gitPanelPlacement) ?? DEFAULT_CONFIG.gitPanelPlacement,
      filesPanelPlacement:
        normalizeMonitorPanelPlacement(parsed.filesPanelPlacement) ??
        DEFAULT_CONFIG.filesPanelPlacement,
    };
  } catch {
    return null;
  }
}

function legacyLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readLegacyLocalStorageCollapsed(): boolean | null {
  const storage = legacyLocalStorage();
  if (!storage) return null;
  try {
    return normalizeRightPanelCollapsed(storage.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY));
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage(): void {
  const storage = legacyLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY);
  } catch {
    /* ignore */
  }
}

async function deleteLegacyAppSettings(): Promise<void> {
  await Promise.all([
    deleteAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY).catch(() => {}),
    deleteAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY).catch(() => {}),
  ]);
}

async function persistConfig(config: WiseDefaultConfigV1): Promise<void> {
  await setAppSettingJson(WISE_DEFAULT_CONFIG_KEY, config);
}

function dispatchConnectionKindChanged(kind: ClaudeSessionConnectionKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_CLAUDE_CONNECTION_KIND_CHANGED, { detail: { kind } }));
}

function dispatchRightPanelDefaultChanged(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_RIGHT_PANEL_DEFAULT_CHANGED, { detail: { collapsed } }));
}

function dispatchTopbarChromeDefaultChanged(
  config: Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showSessionDataLinkTopbar"
  >,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, {
      detail: {
        showLlmProxyTopbar: config.showLlmProxyTopbar,
        showFccTopbar: config.showFccTopbar,
        showFccTrafficTopbar: config.showFccTrafficTopbar,
        showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
      },
    }),
  );
}

async function migrateLegacyConfig(): Promise<WiseDefaultConfigV1 | null> {
  let connectionKind: ClaudeSessionConnectionKind | null = null;
  let rightPanelDefaultCollapsed: boolean | null = null;

  const legacyConnection = normalizeConnectionKind(await getAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY));
  if (legacyConnection) connectionKind = legacyConnection;

  const legacyRightPanel = normalizeRightPanelCollapsed(
    await getAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY),
  );
  if (legacyRightPanel !== null) rightPanelDefaultCollapsed = legacyRightPanel;

  const legacyLocalRight = readLegacyLocalStorageCollapsed();
  if (legacyLocalRight !== null) rightPanelDefaultCollapsed = legacyLocalRight;

  if (connectionKind === null && rightPanelDefaultCollapsed === null) return null;

  return {
    version: 1,
    connectionKind: connectionKind ?? DEFAULT_CONFIG.connectionKind,
    rightPanelDefaultCollapsed:
      rightPanelDefaultCollapsed ?? DEFAULT_CONFIG.rightPanelDefaultCollapsed,
    showLlmProxyTopbar: DEFAULT_CONFIG.showLlmProxyTopbar,
    showFccTopbar: DEFAULT_CONFIG.showFccTopbar,
    showFccTrafficTopbar: DEFAULT_CONFIG.showFccTrafficTopbar,
    showSessionDataLinkTopbar: DEFAULT_CONFIG.showSessionDataLinkTopbar,
    leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
    showLeftSidebarMonitorPanel: DEFAULT_CONFIG.showLeftSidebarMonitorPanel,
    monitorPanelPlacement: DEFAULT_CONFIG.monitorPanelPlacement,
    executionEnvironmentDispatchHistoryDays: DEFAULT_CONFIG.executionEnvironmentDispatchHistoryDays,
    atMentionDefaultTarget: DEFAULT_CONFIG.atMentionDefaultTarget,
    atMentionShortcutByTarget: DEFAULT_CONFIG.atMentionShortcutByTarget,
    composerCommonPhrases: DEFAULT_CONFIG.composerCommonPhrases,
    showWorkspaceQuickActionsPanel: DEFAULT_CONFIG.showWorkspaceQuickActionsPanel,
    showWorkspaceMemosPanel: DEFAULT_CONFIG.showWorkspaceMemosPanel,
    showWorkspaceTodosPanel: DEFAULT_CONFIG.showWorkspaceTodosPanel,
    fileTreeOpenInNewPane: DEFAULT_CONFIG.fileTreeOpenInNewPane,
    gitPanelPlacement: DEFAULT_CONFIG.gitPanelPlacement,
    filesPanelPlacement: DEFAULT_CONFIG.filesPanelPlacement,
  };
}

function dispatchLeftSidebarHubQuickEntriesChanged(entries: LeftSidebarHubQuickEntryId[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED, {
      detail: { leftSidebarHubQuickEntries: entries },
    }),
  );
}

function dispatchLeftSidebarMonitorPanelChanged(visible: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, {
      detail: { showLeftSidebarMonitorPanel: visible },
    }),
  );
}

function dispatchMonitorPanelPlacementChanged(placement: MonitorPanelPlacement): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_MONITOR_PANEL_PLACEMENT_CHANGED, {
      detail: { monitorPanelPlacement: placement },
    }),
  );
}

function dispatchWorkspaceInspectorPanelsChanged(panels: WorkspaceInspectorPanelsDefaults): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED, {
      detail: { ...panels },
    }),
  );
}

function dispatchFileTreeOpenInNewPaneChanged(openInNewPane: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED, { detail: { openInNewPane } }),
  );
}

function dispatchRepoPanelPlacementChanged(
  gitPanelPlacement: MonitorPanelPlacement,
  filesPanelPlacement: MonitorPanelPlacement,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_REPO_PANEL_PLACEMENT_CHANGED, {
      detail: { gitPanelPlacement, filesPanelPlacement },
    }),
  );
}

/** 将旧版代码默认写入库的 `oneshot` 升为当前产品默认 `streaming`（仅执行一次）。 */
async function maybeUpgradeOneshotDefaultToStreaming(
  config: WiseDefaultConfigV1,
): Promise<WiseDefaultConfigV1> {
  if (config.connectionKind !== "oneshot") return config;
  if ((await getAppSetting(WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY)) === "1") {
    return config;
  }
  const next: WiseDefaultConfigV1 = { ...config, connectionKind: "streaming" };
  await persistConfig(next);
  await setAppSetting(WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY, "1");
  dispatchConnectionKindChanged("streaming");
  return next;
}

/** 从 `app_settings` 读取默认配置；无记录时写入默认值并返回。 */
export async function loadWiseDefaultConfig(): Promise<WiseDefaultConfigV1> {
  const fromJson = parseConfigJson(await getAppSetting(WISE_DEFAULT_CONFIG_KEY));
  if (fromJson) {
    return await maybeUpgradeOneshotDefaultToStreaming(fromJson);
  }

  const migrated = await migrateLegacyConfig();
  const resolved = migrated ?? DEFAULT_CONFIG;
  await persistConfig(resolved);
  await deleteLegacyAppSettings();
  clearLegacyLocalStorage();
  return await maybeUpgradeOneshotDefaultToStreaming(resolved);
}

export async function saveWiseDefaultConfig(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "connectionKind"
      | "rightPanelDefaultCollapsed"
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showSessionDataLinkTopbar"
      | "leftSidebarHubQuickEntries"
      | "showLeftSidebarMonitorPanel"
      | "monitorPanelPlacement"
      | "executionEnvironmentDispatchHistoryDays"
      | "atMentionDefaultTarget"
      | "atMentionShortcutByTarget"
      | "composerCommonPhrases"
      | "showWorkspaceQuickActionsPanel"
      | "showWorkspaceMemosPanel"
      | "showWorkspaceTodosPanel"
      | "fileTreeOpenInNewPane"
      | "gitPanelPlacement"
      | "filesPanelPlacement"
    >
  >,
): Promise<WiseDefaultConfigV1> {
  const current = await loadWiseDefaultConfig();
  const next: WiseDefaultConfigV1 = {
    version: 1,
    connectionKind: patch.connectionKind ?? current.connectionKind,
    rightPanelDefaultCollapsed:
      patch.rightPanelDefaultCollapsed ?? current.rightPanelDefaultCollapsed,
    showLlmProxyTopbar: patch.showLlmProxyTopbar ?? current.showLlmProxyTopbar,
    showFccTopbar: patch.showFccTopbar ?? current.showFccTopbar,
    showFccTrafficTopbar: patch.showFccTrafficTopbar ?? current.showFccTrafficTopbar,
    showSessionDataLinkTopbar:
      patch.showSessionDataLinkTopbar ?? current.showSessionDataLinkTopbar,
    leftSidebarHubQuickEntries:
      patch.leftSidebarHubQuickEntries !== undefined
        ? normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries)
        : current.leftSidebarHubQuickEntries,
    showLeftSidebarMonitorPanel:
      patch.showLeftSidebarMonitorPanel ?? current.showLeftSidebarMonitorPanel,
    monitorPanelPlacement: patch.monitorPanelPlacement ?? current.monitorPanelPlacement,
    executionEnvironmentDispatchHistoryDays:
      patch.executionEnvironmentDispatchHistoryDays !== undefined
        ? normalizeExecutionEnvironmentDispatchHistoryDays(patch.executionEnvironmentDispatchHistoryDays)
        : current.executionEnvironmentDispatchHistoryDays,
    atMentionDefaultTarget:
      patch.atMentionDefaultTarget !== undefined
        ? normalizeAtMentionDefaultTarget(patch.atMentionDefaultTarget)
        : current.atMentionDefaultTarget,
    atMentionShortcutByTarget:
      patch.atMentionShortcutByTarget !== undefined
        ? normalizeAtMentionShortcutByTarget(patch.atMentionShortcutByTarget)
        : current.atMentionShortcutByTarget,
    composerCommonPhrases:
      patch.composerCommonPhrases !== undefined
        ? normalizeComposerCommonPhrases(patch.composerCommonPhrases)
        : current.composerCommonPhrases,
    showWorkspaceQuickActionsPanel:
      patch.showWorkspaceQuickActionsPanel ?? current.showWorkspaceQuickActionsPanel,
    showWorkspaceMemosPanel: patch.showWorkspaceMemosPanel ?? current.showWorkspaceMemosPanel,
    showWorkspaceTodosPanel: patch.showWorkspaceTodosPanel ?? current.showWorkspaceTodosPanel,
    fileTreeOpenInNewPane: patch.fileTreeOpenInNewPane ?? current.fileTreeOpenInNewPane,
    gitPanelPlacement: patch.gitPanelPlacement ?? current.gitPanelPlacement,
    filesPanelPlacement: patch.filesPanelPlacement ?? current.filesPanelPlacement,
  };
  if (patch.connectionKind !== undefined) {
    next.connectionKind = normalizeConnectionKind(patch.connectionKind) ?? current.connectionKind;
  }
  if (patch.showLlmProxyTopbar !== undefined) {
    next.showLlmProxyTopbar = normalizeBoolean(patch.showLlmProxyTopbar);
  }
  if (patch.showFccTopbar !== undefined) {
    next.showFccTopbar = normalizeBoolean(patch.showFccTopbar);
  }
  if (patch.showFccTrafficTopbar !== undefined) {
    next.showFccTrafficTopbar = normalizeBoolean(patch.showFccTrafficTopbar);
  }
  if (patch.showSessionDataLinkTopbar !== undefined) {
    next.showSessionDataLinkTopbar = normalizeBoolean(patch.showSessionDataLinkTopbar);
  }
  if (patch.leftSidebarHubQuickEntries !== undefined) {
    next.leftSidebarHubQuickEntries = normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries);
  }
  if (patch.showLeftSidebarMonitorPanel !== undefined) {
    next.showLeftSidebarMonitorPanel = normalizeBoolean(patch.showLeftSidebarMonitorPanel);
  }
  if (patch.monitorPanelPlacement !== undefined) {
    next.monitorPanelPlacement =
      normalizeMonitorPanelPlacement(patch.monitorPanelPlacement) ?? current.monitorPanelPlacement;
  }
  if (patch.executionEnvironmentDispatchHistoryDays !== undefined) {
    next.executionEnvironmentDispatchHistoryDays = normalizeExecutionEnvironmentDispatchHistoryDays(
      patch.executionEnvironmentDispatchHistoryDays,
    );
  }
  if (patch.atMentionDefaultTarget !== undefined) {
    next.atMentionDefaultTarget = normalizeAtMentionDefaultTarget(patch.atMentionDefaultTarget);
  }
  if (patch.atMentionShortcutByTarget !== undefined) {
    next.atMentionShortcutByTarget = normalizeAtMentionShortcutByTarget(patch.atMentionShortcutByTarget);
  }
  if (patch.composerCommonPhrases !== undefined) {
    next.composerCommonPhrases = normalizeComposerCommonPhrases(patch.composerCommonPhrases);
  }
  if (patch.showWorkspaceQuickActionsPanel !== undefined) {
    next.showWorkspaceQuickActionsPanel = normalizeBoolean(patch.showWorkspaceQuickActionsPanel);
  }
  if (patch.showWorkspaceMemosPanel !== undefined) {
    next.showWorkspaceMemosPanel = normalizeBoolean(patch.showWorkspaceMemosPanel);
  }
  if (patch.showWorkspaceTodosPanel !== undefined) {
    next.showWorkspaceTodosPanel = normalizeBoolean(patch.showWorkspaceTodosPanel);
  }
  if (patch.fileTreeOpenInNewPane !== undefined) {
    next.fileTreeOpenInNewPane = normalizeBoolean(patch.fileTreeOpenInNewPane);
  }
  if (patch.gitPanelPlacement !== undefined) {
    next.gitPanelPlacement =
      normalizeMonitorPanelPlacement(patch.gitPanelPlacement) ?? current.gitPanelPlacement;
  }
  if (patch.filesPanelPlacement !== undefined) {
    next.filesPanelPlacement =
      normalizeMonitorPanelPlacement(patch.filesPanelPlacement) ?? current.filesPanelPlacement;
  }
  await persistConfig(next);
  await deleteLegacyAppSettings();
  clearLegacyLocalStorage();

  if (patch.connectionKind !== undefined && next.connectionKind !== current.connectionKind) {
    dispatchConnectionKindChanged(next.connectionKind);
  }
  if (
    patch.rightPanelDefaultCollapsed !== undefined &&
    next.rightPanelDefaultCollapsed !== current.rightPanelDefaultCollapsed
  ) {
    dispatchRightPanelDefaultChanged(next.rightPanelDefaultCollapsed);
  }
  if (
    patch.showLlmProxyTopbar !== undefined ||
    patch.showFccTopbar !== undefined ||
    patch.showFccTrafficTopbar !== undefined ||
    patch.showSessionDataLinkTopbar !== undefined
  ) {
    if (
      next.showLlmProxyTopbar !== current.showLlmProxyTopbar ||
      next.showFccTopbar !== current.showFccTopbar ||
      next.showFccTrafficTopbar !== current.showFccTrafficTopbar ||
      next.showSessionDataLinkTopbar !== current.showSessionDataLinkTopbar
    ) {
      dispatchTopbarChromeDefaultChanged({
        showLlmProxyTopbar: next.showLlmProxyTopbar,
        showFccTopbar: next.showFccTopbar,
        showFccTrafficTopbar: next.showFccTrafficTopbar,
        showSessionDataLinkTopbar: next.showSessionDataLinkTopbar,
      });
    }
  }
  if (
    patch.leftSidebarHubQuickEntries !== undefined &&
    JSON.stringify(next.leftSidebarHubQuickEntries) !== JSON.stringify(current.leftSidebarHubQuickEntries)
  ) {
    dispatchLeftSidebarHubQuickEntriesChanged(next.leftSidebarHubQuickEntries);
  }
  if (
    patch.showLeftSidebarMonitorPanel !== undefined &&
    next.showLeftSidebarMonitorPanel !== current.showLeftSidebarMonitorPanel
  ) {
    dispatchLeftSidebarMonitorPanelChanged(next.showLeftSidebarMonitorPanel);
  }
  if (
    patch.monitorPanelPlacement !== undefined &&
    next.monitorPanelPlacement !== current.monitorPanelPlacement
  ) {
    dispatchMonitorPanelPlacementChanged(next.monitorPanelPlacement);
  }
  if (
    patch.executionEnvironmentDispatchHistoryDays !== undefined &&
    next.executionEnvironmentDispatchHistoryDays !== current.executionEnvironmentDispatchHistoryDays
  ) {
    dispatchExecutionEnvironmentDispatchHistoryDaysChanged(next.executionEnvironmentDispatchHistoryDays);
  }
  if (
    patch.atMentionDefaultTarget !== undefined &&
    JSON.stringify(next.atMentionDefaultTarget) !== JSON.stringify(current.atMentionDefaultTarget)
  ) {
    dispatchAtMentionDefaultTargetChanged(next.atMentionDefaultTarget);
  }
  if (
    patch.atMentionShortcutByTarget !== undefined &&
    JSON.stringify(next.atMentionShortcutByTarget) !== JSON.stringify(current.atMentionShortcutByTarget)
  ) {
    dispatchAtMentionShortcutsChanged(next.atMentionShortcutByTarget);
  }
  if (
    patch.composerCommonPhrases !== undefined &&
    JSON.stringify(next.composerCommonPhrases) !== JSON.stringify(current.composerCommonPhrases)
  ) {
    dispatchComposerCommonPhrasesChanged(next.composerCommonPhrases);
  }
  if (
    patch.showWorkspaceQuickActionsPanel !== undefined ||
    patch.showWorkspaceMemosPanel !== undefined ||
    patch.showWorkspaceTodosPanel !== undefined
  ) {
    if (
      next.showWorkspaceQuickActionsPanel !== current.showWorkspaceQuickActionsPanel ||
      next.showWorkspaceMemosPanel !== current.showWorkspaceMemosPanel ||
      next.showWorkspaceTodosPanel !== current.showWorkspaceTodosPanel
    ) {
      dispatchWorkspaceInspectorPanelsChanged({
        showWorkspaceQuickActionsPanel: next.showWorkspaceQuickActionsPanel,
        showWorkspaceMemosPanel: next.showWorkspaceMemosPanel,
        showWorkspaceTodosPanel: next.showWorkspaceTodosPanel,
      });
    }
  }
  if (
    patch.fileTreeOpenInNewPane !== undefined &&
    next.fileTreeOpenInNewPane !== current.fileTreeOpenInNewPane
  ) {
    dispatchFileTreeOpenInNewPaneChanged(next.fileTreeOpenInNewPane);
  }
  if (
    (patch.gitPanelPlacement !== undefined || patch.filesPanelPlacement !== undefined) &&
    (next.gitPanelPlacement !== current.gitPanelPlacement ||
      next.filesPanelPlacement !== current.filesPanelPlacement)
  ) {
    dispatchRepoPanelPlacementChanged(next.gitPanelPlacement, next.filesPanelPlacement);
  }

  return next;
}

function dispatchExecutionEnvironmentDispatchHistoryDaysChanged(
  days: ExecutionEnvironmentDispatchHistoryDays,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED, { detail: { days } }),
  );
}

function dispatchAtMentionDefaultTargetChanged(target: AtMentionDefaultTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_AT_MENTION_DEFAULT_CHANGED, { detail: { atMentionDefaultTarget: target } }),
  );
}

export async function loadAtMentionDefaultTargetFromStore(): Promise<AtMentionDefaultTarget> {
  return (await loadWiseDefaultConfig()).atMentionDefaultTarget;
}

export async function saveAtMentionDefaultTargetToStore(
  target: AtMentionDefaultTarget,
): Promise<void> {
  await saveWiseDefaultConfig({ atMentionDefaultTarget: normalizeAtMentionDefaultTarget(target) });
}

function dispatchAtMentionShortcutsChanged(shortcuts: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_AT_MENTION_SHORTCUTS_CHANGED, {
      detail: { atMentionShortcutByTarget: shortcuts },
    }),
  );
}

export async function loadAtMentionShortcutByTargetFromStore(): Promise<Record<string, string>> {
  return (await loadWiseDefaultConfig()).atMentionShortcutByTarget;
}

function stripComposerChordFromPeers(
  chord: string,
  current: WiseDefaultConfigV1,
  except: { atMentionTargetKey?: string; phraseId?: string },
): Pick<WiseDefaultConfigV1, "atMentionShortcutByTarget" | "composerCommonPhrases"> {
  const atMentionShortcutByTarget = { ...current.atMentionShortcutByTarget };
  for (const [key, existing] of Object.entries(atMentionShortcutByTarget)) {
    if (key !== except.atMentionTargetKey && existing === chord) {
      delete atMentionShortcutByTarget[key];
    }
  }
  const composerCommonPhrases = current.composerCommonPhrases.map((phrase) => {
    if (phrase.id === except.phraseId || phrase.chord !== chord) return phrase;
    const { chord: _removed, ...rest } = phrase;
    return rest;
  });
  return { atMentionShortcutByTarget, composerCommonPhrases };
}

export async function saveAtMentionShortcutForTarget(
  target: AtMentionDefaultTarget,
  chord: string,
): Promise<Record<string, string>> {
  const targetKey = encodeAtMentionDefaultSelectValue(target);
  const current = await loadWiseDefaultConfig();
  const next = { ...current.atMentionShortcutByTarget };
  const normalized = normalizeChord(chord);
  if (!normalized) {
    delete next[targetKey];
    await saveWiseDefaultConfig({ atMentionShortcutByTarget: next });
    return next;
  }
  const stripped = stripComposerChordFromPeers(normalized, current, { atMentionTargetKey: targetKey });
  next[targetKey] = normalized;
  await saveWiseDefaultConfig({
    atMentionShortcutByTarget: next,
    composerCommonPhrases: stripped.composerCommonPhrases,
  });
  return next;
}

function dispatchComposerCommonPhrasesChanged(phrases: ComposerCommonPhrase[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_COMPOSER_COMMON_PHRASES_CHANGED, {
      detail: { composerCommonPhrases: phrases },
    }),
  );
}

export async function loadComposerCommonPhrasesFromStore(): Promise<ComposerCommonPhrase[]> {
  return [...(await loadWiseDefaultConfig()).composerCommonPhrases];
}

export async function saveComposerCommonPhrasesToStore(
  phrases: ComposerCommonPhrase[],
): Promise<ComposerCommonPhrase[]> {
  const normalized = normalizeComposerCommonPhrases(phrases);
  const current = await loadWiseDefaultConfig();
  let atMentionShortcutByTarget = { ...current.atMentionShortcutByTarget };
  for (const phrase of normalized) {
    if (!phrase.chord) continue;
    const stripped = stripComposerChordFromPeers(
      phrase.chord,
      {
        ...current,
        atMentionShortcutByTarget,
        composerCommonPhrases: normalized,
      },
      { phraseId: phrase.id },
    );
    atMentionShortcutByTarget = stripped.atMentionShortcutByTarget;
  }
  await saveWiseDefaultConfig({
    composerCommonPhrases: normalized,
    atMentionShortcutByTarget,
  });
  return normalized;
}

export function resolveAtMentionTargetFromShortcutKey(
  targetKey: string,
): AtMentionDefaultTarget | null {
  return decodeAtMentionDefaultSelectValue(targetKey);
}

export async function loadExecutionEnvironmentDispatchHistoryDaysFromStore(): Promise<ExecutionEnvironmentDispatchHistoryDays> {
  return (await loadWiseDefaultConfig()).executionEnvironmentDispatchHistoryDays;
}

export async function saveExecutionEnvironmentDispatchHistoryDaysToStore(
  days: ExecutionEnvironmentDispatchHistoryDays,
): Promise<void> {
  await saveWiseDefaultConfig({
    executionEnvironmentDispatchHistoryDays: normalizeExecutionEnvironmentDispatchHistoryDays(days),
  });
}

export async function loadLeftSidebarHubQuickEntriesFromStore(): Promise<LeftSidebarHubQuickEntryId[]> {
  return [...(await loadWiseDefaultConfig()).leftSidebarHubQuickEntries];
}

export async function saveLeftSidebarHubQuickEntriesToStore(
  entries: LeftSidebarHubQuickEntryId[],
): Promise<void> {
  await saveWiseDefaultConfig({ leftSidebarHubQuickEntries: entries });
}

export async function loadLeftSidebarMonitorPanelVisibleFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).showLeftSidebarMonitorPanel;
}

export async function saveLeftSidebarMonitorPanelVisibleToStore(visible: boolean): Promise<void> {
  await saveWiseDefaultConfig({ showLeftSidebarMonitorPanel: visible });
}

export async function loadMonitorPanelPlacementFromStore(): Promise<MonitorPanelPlacement> {
  return (await loadWiseDefaultConfig()).monitorPanelPlacement;
}

export async function saveMonitorPanelPlacementToStore(
  placement: MonitorPanelPlacement,
): Promise<void> {
  const normalized = normalizeMonitorPanelPlacement(placement);
  if (!normalized) return;
  await saveWiseDefaultConfig({ monitorPanelPlacement: normalized });
}

export async function loadMonitorPanelDefaultFromStore(): Promise<{
  visible: boolean;
  placement: MonitorPanelPlacement;
}> {
  const config = await loadWiseDefaultConfig();
  return {
    visible: config.showLeftSidebarMonitorPanel,
    placement: config.monitorPanelPlacement,
  };
}

export async function loadRepoPanelPlacementFromStore(): Promise<{
  gitPanelPlacement: MonitorPanelPlacement;
  filesPanelPlacement: MonitorPanelPlacement;
}> {
  const config = await loadWiseDefaultConfig();
  return {
    gitPanelPlacement: config.gitPanelPlacement,
    filesPanelPlacement: config.filesPanelPlacement,
  };
}

export async function saveRepoPanelPlacementToStore(
  patch: Partial<{
    gitPanelPlacement: MonitorPanelPlacement;
    filesPanelPlacement: MonitorPanelPlacement;
  }>,
): Promise<void> {
  const normalized: Partial<WiseDefaultConfigV1> = {};
  if (patch.gitPanelPlacement !== undefined) {
    const placement = normalizeMonitorPanelPlacement(patch.gitPanelPlacement);
    if (placement) normalized.gitPanelPlacement = placement;
  }
  if (patch.filesPanelPlacement !== undefined) {
    const placement = normalizeMonitorPanelPlacement(patch.filesPanelPlacement);
    if (placement) normalized.filesPanelPlacement = placement;
  }
  if (Object.keys(normalized).length === 0) return;
  await saveWiseDefaultConfig(normalized);
}

export async function loadDefaultClaudeConnectionKindFromStore(): Promise<ClaudeSessionConnectionKind> {
  return (await loadWiseDefaultConfig()).connectionKind;
}

export async function saveDefaultClaudeConnectionKindToStore(
  kind: ClaudeSessionConnectionKind,
): Promise<void> {
  const normalized = normalizeConnectionKind(kind);
  if (!normalized) return;
  await saveWiseDefaultConfig({ connectionKind: normalized });
}

export async function loadRightPanelDefaultCollapsedFromStore(
  fallback: boolean = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
): Promise<boolean> {
  const fromStore = (await loadWiseDefaultConfig()).rightPanelDefaultCollapsed;
  return typeof fromStore === "boolean" ? fromStore : fallback;
}

export async function saveRightPanelDefaultCollapsedToStore(collapsed: boolean): Promise<void> {
  await saveWiseDefaultConfig({ rightPanelDefaultCollapsed: collapsed });
}

/** @alias loadRightPanelDefaultCollapsedFromStore */
export const loadRightPanelDefaultCollapsed = loadRightPanelDefaultCollapsedFromStore;

/** @alias saveRightPanelDefaultCollapsedToStore */
export const saveRightPanelDefaultCollapsed = saveRightPanelDefaultCollapsedToStore;

export async function loadTopbarChromeDefaultsFromStore(): Promise<
  Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showSessionDataLinkTopbar"
  >
> {
  const config = await loadWiseDefaultConfig();
  return {
    showLlmProxyTopbar: config.showLlmProxyTopbar,
    showFccTopbar: config.showFccTopbar,
    showFccTrafficTopbar: config.showFccTrafficTopbar,
    showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
  };
}

export async function saveTopbarChromeDefaultsToStore(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showSessionDataLinkTopbar"
    >
  >,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}

export async function loadWorkspaceInspectorPanelsFromStore(): Promise<WorkspaceInspectorPanelsDefaults> {
  const config = await loadWiseDefaultConfig();
  return {
    showWorkspaceQuickActionsPanel: config.showWorkspaceQuickActionsPanel,
    showWorkspaceMemosPanel: config.showWorkspaceMemosPanel,
    showWorkspaceTodosPanel: config.showWorkspaceTodosPanel,
  };
}

export async function saveWorkspaceInspectorPanelsToStore(
  patch: Partial<WorkspaceInspectorPanelsDefaults>,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}

export async function loadFileTreeOpenInNewPaneFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).fileTreeOpenInNewPane;
}

export async function saveFileTreeOpenInNewPaneToStore(openInNewPane: boolean): Promise<void> {
  await saveWiseDefaultConfig({ fileTreeOpenInNewPane: openInNewPane });
}
