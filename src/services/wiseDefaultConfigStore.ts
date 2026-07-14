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
import {
  MONITOR_PANEL_VISIBLE_ROWS_DEFAULT,
  normalizeMonitorPanelVisibleRows,
} from "../constants/monitorPanelLayout";
import {
  WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT,
  normalizeWorkspaceListVisibleRows,
} from "../constants/workspaceListLayout";
import {
  REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX,
  clampRepoPanelSplitHeightPx,
} from "../constants/repoPanelLayout";
import { normalizeFeedbackLoopMaxCycles } from "../utils/sessionFeedbackLoop";
import {
  normalizeFeedbackGlobalRules,
  type FeedbackGlobalRuleV1,
} from "../utils/sessionFeedbackGlobalRules";
import { normalizeChord } from "../utils/atMentionShortcutChord";
import { deleteAppSetting, getAppSetting, setAppSetting, setAppSettingJson } from "./appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const WISE_DEFAULT_CONFIG_KEY = "wise.defaultConfig.v1";

/** 一次性：产品默认由逐轮改为长驻后，将已持久化的 `oneshot` 升为 `streaming`。 */
export const WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY =
  "wise.defaultConfig.oneshotToStreaming.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

export const CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK: ClaudeSessionConnectionKind = "streaming";

export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

export const WISE_TOPBAR_CHROME_DEFAULT_CHANGED = "wise:topbar-chrome-default-changed";

export const WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED =
  "wise:composer-footer-chrome-default-changed";

export const WISE_FEATURE_PANEL_CHROME_DEFAULT_CHANGED =
  "wise:feature-panel-chrome-default-changed";

export const WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED = "wise:left-sidebar-hub-quick-entries-changed";

export const WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED = "wise:left-sidebar-monitor-panel-changed";

export const WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED = "wise:left-sidebar-workspace-list-changed";

export const WISE_WORKSPACE_LIST_VISIBLE_ROWS_CHANGED = "wise:workspace-list-visible-rows-changed";

export const WISE_LEFT_SIDEBAR_REPOSITORY_ICON_BADGES_CHANGED =
  "wise:left-sidebar-repository-icon-badges-changed";

export const WISE_MONITOR_PANEL_PLACEMENT_CHANGED = "wise:monitor-panel-placement-changed";

export const WISE_MONITOR_PANEL_VISIBLE_ROWS_CHANGED = "wise:monitor-panel-visible-rows-changed";

export const WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED =
  "wise:execution-environment-dispatch-history-days-changed";

export const WISE_AT_MENTION_DEFAULT_CHANGED = "wise:at-mention-default-changed";

export const WISE_AT_MENTION_SHORTCUTS_CHANGED = "wise:at-mention-shortcuts-changed";

export const WISE_COMPOSER_COMMON_PHRASES_CHANGED = "wise:composer-common-phrases-changed";

export const WISE_COMPOSER_DEFAULT_INSTRUCTION_CHANGED = "wise:composer-default-instruction-changed";

export const WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED = "wise:workspace-inspector-panels-changed";

export const WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED = "wise:file-tree-open-in-new-pane-changed";

export const WISE_REPO_PANEL_PLACEMENT_CHANGED = "wise:repo-panel-placement-changed";
export const WISE_REPO_PANEL_SPLIT_MODE_CHANGED = "wise:repo-panel-split-mode-changed";
export const WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED = "wise:repo-panel-split-height-changed";

export const WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED = "wise:open-in-terminal-shortcut-changed";

export const WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED = "wise:open-in-editor-shortcut-changed";

export const WISE_SESSION_FEEDBACK_LOOP_CHANGED = "wise:session-feedback-loop-changed";

export interface SessionFeedbackLoopSettings {
  enabled: boolean;
  maxCycles: number;
  autoStart: boolean;
  earlyStopConvergence: boolean;
  autoSaveHabitsToComposer: boolean;
  injectHabitsToSystemPrompt: boolean;
  /** 优化 CLAUDE.md / rules / memory / MCP / skills 等持久配置 */
  optimizeConfigArtifacts: boolean;
  globalRules: FeedbackGlobalRuleV1[];
  injectGlobalRules: boolean;
  /** worker 解析出非破坏性补丁后自动落盘 */
  autoApplyConfigPatches: boolean;
  /** 评分回归时自动回滚本轮应用的补丁 */
  autoRollbackOnRegression: boolean;
  /** 补丁应用后自动触发验证轮次 */
  autoVerifyAfterApply: boolean;
}

export type MonitorPanelPlacement = "left" | "right";

/** 主会话底栏「执行环境」与「模型切换」触发器显示模式。 */
export type ComposerFooterTriggerDisplayMode = "full" | "icon";

export type WorkspaceInspectorPanelsDefaults = Pick<
  WiseDefaultConfigV1,
  | "showWorkspaceQuickActionsPanel"
  | "showWorkspaceTodosPanel"
>;

export type ComposerFooterChromeDefaults = Pick<
  WiseDefaultConfigV1,
  | "showComposerFooterAttachButton"
  | "showComposerFooterScreenshotButton"
  | "showComposerFooterVoiceButton"
  | "showComposerFooterContextRing"
  | "showComposerFooterCommonPhrases"
  | "showComposerFooterRuntimeSettings"
  | "showComposerFooterModelPicker"
  | "composerFooterTriggerDisplayMode"
>;

export type FeaturePanelChromeDefaults = Pick<
  WiseDefaultConfigV1,
  | "showFeaturePanelHistorySessions"
  | "showFeaturePanelHistoryMessages"
  | "showFeaturePanelScheduledTasks"
>;

export interface WiseDefaultConfigV1 {
  version: 1;
  connectionKind: ClaudeSessionConnectionKind;
  /** 主会话顶栏 LLM 代理图标；默认隐藏。 */
  showLlmProxyTopbar: boolean;
  /** 主会话顶栏 Free Claude Code 图标；默认隐藏。 */
  showFccTopbar: boolean;
  /** 主会话顶栏 FCC 请求流量图标；默认隐藏。 */
  showFccTrafficTopbar: boolean;
  /** 主会话顶栏 OpenCode 代理图标；默认隐藏。 */
  showOpencodeProxyTopbar: boolean;
  /** 主会话顶栏全链路分析图标；默认隐藏。 */
  showSessionDataLinkTopbar: boolean;
  /** 主会话顶栏反馈神经网图标；默认隐藏。 */
  showSessionFeedbackLoopTopbar: boolean;
  /** 中栏顶栏远程入口（钉钉 / WebSocket 开关与配置）；默认显示。 */
  showRemoteEntryTopbar: boolean;
  /** 主会话顶栏当前仓库 / 工作区名称；默认不显示。 */
  showTopbarRepositoryName: boolean;
  /** 主会话顶栏「在终端中打开」按钮；默认显示。 */
  showTopbarOpenInTerminal: boolean;
  /** 主会话顶栏「在 Finder 中打开目录」按钮；默认显示。 */
  showTopbarOpenDirectory: boolean;
  /** 左栏 AI 工作台快捷入口；默认 MCP、技能、自动化。 */
  leftSidebarHubQuickEntries: LeftSidebarHubQuickEntryId[];
  /** 运行面板（终端 / 工作流运行态）是否显示；默认显示。 */
  showLeftSidebarMonitorPanel: boolean;
  /** 左栏工作区与仓库树是否显示；默认显示。 */
  showLeftSidebarWorkspaceList: boolean;
  /** 左栏工作区树内容区默认可见行数（与文件树并存时封顶高度）。 */
  workspaceListVisibleRows: number;
  /** 左栏工作区列表中是否显示仓库圆形角标；默认隐藏。 */
  showRepositoryIconBadgesInWorkspaceList: boolean;
  /** 运行面板默认栏位；默认左栏。 */
  monitorPanelPlacement: MonitorPanelPlacement;
  /** 左栏运行面板内容区默认可见行数（终端 + 派发 + 工作流合计）。 */
  monitorPanelVisibleRows: number;
  /** 左栏「任务派发」默认查询近 N 天历史；默认 1 天。 */
  executionEnvironmentDispatchHistoryDays: ExecutionEnvironmentDispatchHistoryDays;
  /** 主会话 @ 空查询打开时默认高亮的执行环境或终端。 */
  atMentionDefaultTarget: AtMentionDefaultTarget;
  /** `encodeAtMentionDefaultSelectValue` → chord（如 `Mod+Shift+Digit2`）。 */
  atMentionShortcutByTarget: Record<string, string>;
  /** 主会话常用语：快捷键发送或点击按钮发送。 */
  composerCommonPhrases: ComposerCommonPhrase[];
  /** 主会话发送时自动前缀的斜杠指令（如 /autopilot）。 */
  composerDefaultInstruction: string;
  /** 主会话输入框底栏附件上传（+）按钮；默认显示。 */
  showComposerFooterAttachButton: boolean;
  /** 主会话输入框底栏截屏按钮；默认显示。 */
  showComposerFooterScreenshotButton: boolean;
  /** 主会话输入框底栏语音听写按钮；默认显示。 */
  showComposerFooterVoiceButton: boolean;
  /** 主会话输入框底栏上下文占用环；默认显示。 */
  showComposerFooterContextRing: boolean;
  /** 主会话输入框底栏常用语按钮；默认显示。 */
  showComposerFooterCommonPhrases: boolean;
  /** 主会话输入框底栏执行环境 / 连接方式设置；默认显示。 */
  showComposerFooterRuntimeSettings: boolean;
  /** 主会话输入框底栏模型选择；默认显示。 */
  showComposerFooterModelPicker: boolean;
  /** 主会话底栏「执行环境」与「模型切换」触发器显示模式：完整（图标+文字）或仅图标；默认完整。 */
  composerFooterTriggerDisplayMode: ComposerFooterTriggerDisplayMode;
  /** 右栏工作区快捷操作卡片；默认显示。 */
  showWorkspaceQuickActionsPanel: boolean;
  /** 右栏待办事项卡片；默认显示。 */
  showWorkspaceTodosPanel: boolean;
  /** 文件树点击文件时在新窗格打开，而非占用当前会话主区。 */
  fileTreeOpenInNewPane: boolean;
  /** Git 变更面板默认栏位；默认左栏。 */
  gitPanelPlacement: MonitorPanelPlacement;
  /** 仓库文件树默认栏位；默认左栏（与 Git 同在左栏时 Tab 切换）。 */
  filesPanelPlacement: MonitorPanelPlacement;
  /** Git 与文件树同栏时上下分栏展示（而非 Tab 切换）。 */
  repoPanelSplitMode: boolean;
  /** Split 模式下 Git 面板高度（px）；由拖动把手调整并持久化。 */
  repoPanelSplitHeightPx: number;
  /** 在仓库列表中「打开终端」的快捷键 chord（如 Mod+Shift+T）；空=未设置。 */
  openInTerminalShortcut: string;
  /** 在仓库列表中「打开编辑器」的快捷键 chord（如 Mod+Shift+E）；空=未设置。 */
  openInEditorShortcut: string;
  /** 会话全链路「反馈神经网」自我优化闭环；开发功能，默认关闭。 */
  sessionFeedbackLoopEnabled: boolean;
  /** 反馈神经网最大自我优化循环次数（1–5）。 */
  sessionFeedbackLoopMaxCycles: number;
  /** 洞察页检测到警告项时自动启动闭环。 */
  sessionFeedbackLoopAutoStart: boolean;
  /** 指标收敛时提前结束循环。 */
  sessionFeedbackLoopEarlyStop: boolean;
  /** 闭环完成后将习惯写入 Composer 常用语。 */
  sessionFeedbackLoopSaveHabitsToComposer: boolean;
  /** 会话 spawn 时将神经网习惯追加到 Claude CLI system prompt。 */
  sessionFeedbackLoopInjectSystemPrompt: boolean;
  /** 反馈神经网优化 CLAUDE.md / rules / memory / MCP / skills 等持久配置。 */
  sessionFeedbackLoopOptimizeConfigArtifacts: boolean;
  /** 反馈神经网提升的全局 spawn 规则。 */
  sessionFeedbackLoopGlobalRules: FeedbackGlobalRuleV1[];
  /** spawn 时注入全局规则到 system prompt。 */
  sessionFeedbackLoopInjectGlobalRules: boolean;
  /** worker 解析出非破坏性补丁后自动落盘（追加章节 / 禁用 MCP）。 */
  sessionFeedbackLoopAutoApplyConfigPatches: boolean;
  /** 闭环评分回归时自动回滚本轮应用的补丁。 */
  sessionFeedbackLoopAutoRollbackOnRegression: boolean;
  /** 补丁应用后自动触发验证轮次，将效果纳入循环评分。 */
  sessionFeedbackLoopAutoVerifyAfterApply: boolean;
  /** 会话功能面板「历史会话」按钮；默认显示。 */
  showFeaturePanelHistorySessions: boolean;
  /** 会话功能面板「历史消息」按钮；默认显示。 */
  showFeaturePanelHistoryMessages: boolean;
  /** 会话功能面板「定时任务」按钮；默认显示。 */
  showFeaturePanelScheduledTasks: boolean;
}

const DEFAULT_CONFIG: WiseDefaultConfigV1 = {
  version: 1,
  connectionKind: CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  showLlmProxyTopbar: false,
  showFccTopbar: false,
  showFccTrafficTopbar: false,
  showOpencodeProxyTopbar: false,
  showSessionDataLinkTopbar: true,
  showSessionFeedbackLoopTopbar: true,
  showRemoteEntryTopbar: true,
  showTopbarRepositoryName: false,
  showTopbarOpenInTerminal: true,
  showTopbarOpenDirectory: true,
  leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
  showLeftSidebarMonitorPanel: true,
  showLeftSidebarWorkspaceList: true,
  workspaceListVisibleRows: WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT,
  showRepositoryIconBadgesInWorkspaceList: false,
  monitorPanelPlacement: "left",
  monitorPanelVisibleRows: MONITOR_PANEL_VISIBLE_ROWS_DEFAULT,
  executionEnvironmentDispatchHistoryDays: DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS,
  atMentionDefaultTarget: DEFAULT_AT_MENTION_DEFAULT_TARGET,
  atMentionShortcutByTarget: {},
  composerCommonPhrases: [],
  composerDefaultInstruction: "",
  showComposerFooterAttachButton: true,
  showComposerFooterScreenshotButton: true,
  showComposerFooterVoiceButton: true,
  showComposerFooterContextRing: true,
  showComposerFooterCommonPhrases: true,
  showComposerFooterRuntimeSettings: true,
  showComposerFooterModelPicker: true,
  composerFooterTriggerDisplayMode: "full",
  showWorkspaceQuickActionsPanel: true,
  showWorkspaceTodosPanel: true,
  fileTreeOpenInNewPane: false,
  gitPanelPlacement: "left",
  filesPanelPlacement: "left",
  repoPanelSplitMode: false,
  repoPanelSplitHeightPx: REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX,
  sessionFeedbackLoopEnabled: false,
  sessionFeedbackLoopMaxCycles: 3,
  sessionFeedbackLoopAutoStart: false,
  sessionFeedbackLoopEarlyStop: true,
  sessionFeedbackLoopSaveHabitsToComposer: false,
  sessionFeedbackLoopInjectSystemPrompt: false,
  sessionFeedbackLoopOptimizeConfigArtifacts: true,
  sessionFeedbackLoopGlobalRules: [],
  sessionFeedbackLoopInjectGlobalRules: false,
  sessionFeedbackLoopAutoApplyConfigPatches: false,
  sessionFeedbackLoopAutoRollbackOnRegression: false,
  sessionFeedbackLoopAutoVerifyAfterApply: false,
  showFeaturePanelHistorySessions: true,
  showFeaturePanelHistoryMessages: true,
  showFeaturePanelScheduledTasks: true,
  openInTerminalShortcut: "",
  openInEditorShortcut: "",
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

function normalizeComposerFooterTriggerDisplayMode(
  raw: unknown,
): ComposerFooterTriggerDisplayMode {
  return raw === "full" || raw === "icon"
    ? raw
    : DEFAULT_CONFIG.composerFooterTriggerDisplayMode;
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

function parseConfigJson(raw: string | null | undefined): WiseDefaultConfigV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WiseDefaultConfigV1>;
    const connectionKind = normalizeConnectionKind(parsed.connectionKind);
    if (connectionKind === null) return null;
    return {
      version: 1,
      connectionKind,
      showLlmProxyTopbar: normalizeBoolean(parsed.showLlmProxyTopbar),
      showFccTopbar:
        parsed.showFccTopbar === undefined
          ? DEFAULT_CONFIG.showFccTopbar
          : normalizeBoolean(parsed.showFccTopbar),
      showFccTrafficTopbar: normalizeBoolean(parsed.showFccTrafficTopbar),
      showOpencodeProxyTopbar:
        parsed.showOpencodeProxyTopbar === undefined
          ? DEFAULT_CONFIG.showOpencodeProxyTopbar
          : normalizeBoolean(parsed.showOpencodeProxyTopbar),
      showSessionDataLinkTopbar: normalizeBoolean(parsed.showSessionDataLinkTopbar),
      showSessionFeedbackLoopTopbar: normalizeBoolean(parsed.showSessionFeedbackLoopTopbar),
      showRemoteEntryTopbar:
        parsed.showRemoteEntryTopbar === undefined
          ? DEFAULT_CONFIG.showRemoteEntryTopbar
          : normalizeBoolean(parsed.showRemoteEntryTopbar, DEFAULT_CONFIG.showRemoteEntryTopbar),
      showTopbarRepositoryName:
        parsed.showTopbarRepositoryName === undefined
          ? true
          : normalizeBoolean(parsed.showTopbarRepositoryName, DEFAULT_CONFIG.showTopbarRepositoryName),
      showTopbarOpenInTerminal:
        parsed.showTopbarOpenInTerminal === undefined
          ? DEFAULT_CONFIG.showTopbarOpenInTerminal
          : normalizeBoolean(
              parsed.showTopbarOpenInTerminal,
              DEFAULT_CONFIG.showTopbarOpenInTerminal,
            ),
      showTopbarOpenDirectory:
        parsed.showTopbarOpenDirectory === undefined
          ? DEFAULT_CONFIG.showTopbarOpenDirectory
          : normalizeBoolean(
              parsed.showTopbarOpenDirectory,
              DEFAULT_CONFIG.showTopbarOpenDirectory,
            ),
      leftSidebarHubQuickEntries: normalizeLeftSidebarHubQuickEntries(parsed.leftSidebarHubQuickEntries),
      showLeftSidebarMonitorPanel:
        parsed.showLeftSidebarMonitorPanel === undefined
          ? DEFAULT_CONFIG.showLeftSidebarMonitorPanel
          : normalizeBoolean(parsed.showLeftSidebarMonitorPanel, DEFAULT_CONFIG.showLeftSidebarMonitorPanel),
      showLeftSidebarWorkspaceList:
        parsed.showLeftSidebarWorkspaceList === undefined
          ? DEFAULT_CONFIG.showLeftSidebarWorkspaceList
          : normalizeBoolean(
              parsed.showLeftSidebarWorkspaceList,
              DEFAULT_CONFIG.showLeftSidebarWorkspaceList,
            ),
      workspaceListVisibleRows:
        parsed.workspaceListVisibleRows === undefined
          ? DEFAULT_CONFIG.workspaceListVisibleRows
          : normalizeWorkspaceListVisibleRows(parsed.workspaceListVisibleRows),
      showRepositoryIconBadgesInWorkspaceList:
        parsed.showRepositoryIconBadgesInWorkspaceList === undefined
          ? DEFAULT_CONFIG.showRepositoryIconBadgesInWorkspaceList
          : normalizeBoolean(
              parsed.showRepositoryIconBadgesInWorkspaceList,
              DEFAULT_CONFIG.showRepositoryIconBadgesInWorkspaceList,
            ),
      monitorPanelPlacement:
        normalizeMonitorPanelPlacement(parsed.monitorPanelPlacement) ??
        DEFAULT_CONFIG.monitorPanelPlacement,
      monitorPanelVisibleRows:
        parsed.monitorPanelVisibleRows === undefined
          ? DEFAULT_CONFIG.monitorPanelVisibleRows
          : normalizeMonitorPanelVisibleRows(parsed.monitorPanelVisibleRows),
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
      composerDefaultInstruction:
        typeof parsed.composerDefaultInstruction === "string"
          ? parsed.composerDefaultInstruction.trim()
          : DEFAULT_CONFIG.composerDefaultInstruction,
      showComposerFooterAttachButton:
        parsed.showComposerFooterAttachButton === undefined
          ? DEFAULT_CONFIG.showComposerFooterAttachButton
          : normalizeBoolean(
              parsed.showComposerFooterAttachButton,
              DEFAULT_CONFIG.showComposerFooterAttachButton,
            ),
      showComposerFooterScreenshotButton:
        parsed.showComposerFooterScreenshotButton === undefined
          ? DEFAULT_CONFIG.showComposerFooterScreenshotButton
          : normalizeBoolean(
              parsed.showComposerFooterScreenshotButton,
              DEFAULT_CONFIG.showComposerFooterScreenshotButton,
            ),
      showComposerFooterVoiceButton:
        parsed.showComposerFooterVoiceButton === undefined
          ? DEFAULT_CONFIG.showComposerFooterVoiceButton
          : normalizeBoolean(
              parsed.showComposerFooterVoiceButton,
              DEFAULT_CONFIG.showComposerFooterVoiceButton,
            ),
      showComposerFooterContextRing:
        parsed.showComposerFooterContextRing === undefined
          ? DEFAULT_CONFIG.showComposerFooterContextRing
          : normalizeBoolean(
              parsed.showComposerFooterContextRing,
              DEFAULT_CONFIG.showComposerFooterContextRing,
            ),
      showComposerFooterCommonPhrases:
        parsed.showComposerFooterCommonPhrases === undefined
          ? DEFAULT_CONFIG.showComposerFooterCommonPhrases
          : normalizeBoolean(
              parsed.showComposerFooterCommonPhrases,
              DEFAULT_CONFIG.showComposerFooterCommonPhrases,
            ),
      showComposerFooterRuntimeSettings:
        parsed.showComposerFooterRuntimeSettings === undefined
          ? DEFAULT_CONFIG.showComposerFooterRuntimeSettings
          : normalizeBoolean(
              parsed.showComposerFooterRuntimeSettings,
              DEFAULT_CONFIG.showComposerFooterRuntimeSettings,
            ),
      showComposerFooterModelPicker:
        parsed.showComposerFooterModelPicker === undefined
          ? DEFAULT_CONFIG.showComposerFooterModelPicker
          : normalizeBoolean(
              parsed.showComposerFooterModelPicker,
              DEFAULT_CONFIG.showComposerFooterModelPicker,
            ),
      composerFooterTriggerDisplayMode: normalizeComposerFooterTriggerDisplayMode(
        parsed.composerFooterTriggerDisplayMode,
      ),
      showWorkspaceQuickActionsPanel:
        parsed.showWorkspaceQuickActionsPanel === undefined
          ? DEFAULT_CONFIG.showWorkspaceQuickActionsPanel
          : normalizeBoolean(
              parsed.showWorkspaceQuickActionsPanel,
              DEFAULT_CONFIG.showWorkspaceQuickActionsPanel,
            ),
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
      repoPanelSplitMode:
        typeof parsed.repoPanelSplitMode === "boolean"
          ? parsed.repoPanelSplitMode
          : DEFAULT_CONFIG.repoPanelSplitMode,
      repoPanelSplitHeightPx:
        typeof parsed.repoPanelSplitHeightPx === "number" && Number.isFinite(parsed.repoPanelSplitHeightPx)
          ? clampRepoPanelSplitHeightPx(parsed.repoPanelSplitHeightPx)
          : REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX,
      sessionFeedbackLoopEnabled:
        parsed.sessionFeedbackLoopEnabled === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopEnabled
          : normalizeBoolean(
              parsed.sessionFeedbackLoopEnabled,
              DEFAULT_CONFIG.sessionFeedbackLoopEnabled,
            ),
      sessionFeedbackLoopMaxCycles:
        parsed.sessionFeedbackLoopMaxCycles === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopMaxCycles
          : normalizeFeedbackLoopMaxCycles(parsed.sessionFeedbackLoopMaxCycles),
      sessionFeedbackLoopAutoStart:
        parsed.sessionFeedbackLoopAutoStart === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopAutoStart
          : normalizeBoolean(
              parsed.sessionFeedbackLoopAutoStart,
              DEFAULT_CONFIG.sessionFeedbackLoopAutoStart,
            ),
      sessionFeedbackLoopEarlyStop:
        parsed.sessionFeedbackLoopEarlyStop === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopEarlyStop
          : normalizeBoolean(
              parsed.sessionFeedbackLoopEarlyStop,
              DEFAULT_CONFIG.sessionFeedbackLoopEarlyStop,
            ),
      sessionFeedbackLoopSaveHabitsToComposer:
        parsed.sessionFeedbackLoopSaveHabitsToComposer === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopSaveHabitsToComposer
          : normalizeBoolean(
              parsed.sessionFeedbackLoopSaveHabitsToComposer,
              DEFAULT_CONFIG.sessionFeedbackLoopSaveHabitsToComposer,
            ),
      sessionFeedbackLoopInjectSystemPrompt:
        parsed.sessionFeedbackLoopInjectSystemPrompt === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopInjectSystemPrompt
          : normalizeBoolean(
              parsed.sessionFeedbackLoopInjectSystemPrompt,
              DEFAULT_CONFIG.sessionFeedbackLoopInjectSystemPrompt,
            ),
      sessionFeedbackLoopOptimizeConfigArtifacts:
        parsed.sessionFeedbackLoopOptimizeConfigArtifacts === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopOptimizeConfigArtifacts
          : normalizeBoolean(
              parsed.sessionFeedbackLoopOptimizeConfigArtifacts,
              DEFAULT_CONFIG.sessionFeedbackLoopOptimizeConfigArtifacts,
            ),
      sessionFeedbackLoopGlobalRules: normalizeFeedbackGlobalRules(
        parsed.sessionFeedbackLoopGlobalRules,
      ),
      sessionFeedbackLoopInjectGlobalRules:
        parsed.sessionFeedbackLoopInjectGlobalRules === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopInjectGlobalRules
          : normalizeBoolean(
              parsed.sessionFeedbackLoopInjectGlobalRules,
              DEFAULT_CONFIG.sessionFeedbackLoopInjectGlobalRules,
            ),
      sessionFeedbackLoopAutoApplyConfigPatches:
        parsed.sessionFeedbackLoopAutoApplyConfigPatches === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopAutoApplyConfigPatches
          : normalizeBoolean(
              parsed.sessionFeedbackLoopAutoApplyConfigPatches,
              DEFAULT_CONFIG.sessionFeedbackLoopAutoApplyConfigPatches,
            ),
      sessionFeedbackLoopAutoRollbackOnRegression:
        parsed.sessionFeedbackLoopAutoRollbackOnRegression === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopAutoRollbackOnRegression
          : normalizeBoolean(
              parsed.sessionFeedbackLoopAutoRollbackOnRegression,
              DEFAULT_CONFIG.sessionFeedbackLoopAutoRollbackOnRegression,
            ),
      sessionFeedbackLoopAutoVerifyAfterApply:
        parsed.sessionFeedbackLoopAutoVerifyAfterApply === undefined
          ? DEFAULT_CONFIG.sessionFeedbackLoopAutoVerifyAfterApply
          : normalizeBoolean(
              parsed.sessionFeedbackLoopAutoVerifyAfterApply,
              DEFAULT_CONFIG.sessionFeedbackLoopAutoVerifyAfterApply,
            ),
      showFeaturePanelHistorySessions:
        parsed.showFeaturePanelHistorySessions === undefined
          ? DEFAULT_CONFIG.showFeaturePanelHistorySessions
          : normalizeBoolean(parsed.showFeaturePanelHistorySessions),
      showFeaturePanelHistoryMessages:
        parsed.showFeaturePanelHistoryMessages === undefined
          ? DEFAULT_CONFIG.showFeaturePanelHistoryMessages
          : normalizeBoolean(parsed.showFeaturePanelHistoryMessages),
      showFeaturePanelScheduledTasks:
        parsed.showFeaturePanelScheduledTasks === undefined
          ? DEFAULT_CONFIG.showFeaturePanelScheduledTasks
          : normalizeBoolean(parsed.showFeaturePanelScheduledTasks),
      openInTerminalShortcut:
        typeof parsed.openInTerminalShortcut === "string"
          ? normalizeChord(parsed.openInTerminalShortcut)
          : DEFAULT_CONFIG.openInTerminalShortcut,
      openInEditorShortcut:
        typeof parsed.openInEditorShortcut === "string"
          ? normalizeChord(parsed.openInEditorShortcut)
          : DEFAULT_CONFIG.openInEditorShortcut,
    };
  } catch {
    return null;
  }
}

async function deleteLegacyAppSettings(): Promise<void> {
  await Promise.all([
    deleteAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY).catch(() => {}),
  ]);
}

async function persistConfig(config: WiseDefaultConfigV1): Promise<void> {
  await setAppSettingJson(WISE_DEFAULT_CONFIG_KEY, config);
}

function dispatchConnectionKindChanged(kind: ClaudeSessionConnectionKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_CLAUDE_CONNECTION_KIND_CHANGED, { detail: { kind } }));
}

function dispatchComposerFooterChromeDefaultChanged(config: ComposerFooterChromeDefaults): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED, {
      detail: {
        showComposerFooterAttachButton: config.showComposerFooterAttachButton,
        showComposerFooterScreenshotButton: config.showComposerFooterScreenshotButton,
        showComposerFooterVoiceButton: config.showComposerFooterVoiceButton,
        showComposerFooterContextRing: config.showComposerFooterContextRing,
        showComposerFooterCommonPhrases: config.showComposerFooterCommonPhrases,
        showComposerFooterRuntimeSettings: config.showComposerFooterRuntimeSettings,
        showComposerFooterModelPicker: config.showComposerFooterModelPicker,
        composerFooterTriggerDisplayMode: config.composerFooterTriggerDisplayMode,
      },
    }),
  );
}

function dispatchFeaturePanelChromeDefaultChanged(config: FeaturePanelChromeDefaults): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_FEATURE_PANEL_CHROME_DEFAULT_CHANGED, {
      detail: {
        showFeaturePanelHistorySessions: config.showFeaturePanelHistorySessions,
        showFeaturePanelHistoryMessages: config.showFeaturePanelHistoryMessages,
        showFeaturePanelScheduledTasks: config.showFeaturePanelScheduledTasks,
      },
    }),
  );
}

function dispatchTopbarChromeDefaultChanged(
  config: Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showOpencodeProxyTopbar"
    | "showSessionDataLinkTopbar"
    | "showSessionFeedbackLoopTopbar"
    | "showRemoteEntryTopbar"
    | "showTopbarRepositoryName"
    | "showTopbarOpenInTerminal"
    | "showTopbarOpenDirectory"
  >,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, {
      detail: {
        showLlmProxyTopbar: config.showLlmProxyTopbar,
        showFccTopbar: config.showFccTopbar,
        showFccTrafficTopbar: config.showFccTrafficTopbar,
        showOpencodeProxyTopbar: config.showOpencodeProxyTopbar,
        showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
        showSessionFeedbackLoopTopbar: config.showSessionFeedbackLoopTopbar,
        showRemoteEntryTopbar: config.showRemoteEntryTopbar,
        showTopbarRepositoryName: config.showTopbarRepositoryName,
        showTopbarOpenInTerminal: config.showTopbarOpenInTerminal,
        showTopbarOpenDirectory: config.showTopbarOpenDirectory,
      },
    }),
  );
}

async function migrateLegacyConfig(): Promise<WiseDefaultConfigV1 | null> {
  let connectionKind: ClaudeSessionConnectionKind | null = null;

  const legacyConnection = normalizeConnectionKind(await getAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY));
  if (legacyConnection) connectionKind = legacyConnection;

  if (connectionKind === null) return null;

  return {
    version: 1,
    connectionKind: connectionKind ?? DEFAULT_CONFIG.connectionKind,
    showLlmProxyTopbar: DEFAULT_CONFIG.showLlmProxyTopbar,
    showFccTopbar: DEFAULT_CONFIG.showFccTopbar,
    showFccTrafficTopbar: DEFAULT_CONFIG.showFccTrafficTopbar,
    showOpencodeProxyTopbar: DEFAULT_CONFIG.showOpencodeProxyTopbar,
    showSessionDataLinkTopbar: DEFAULT_CONFIG.showSessionDataLinkTopbar,
    showSessionFeedbackLoopTopbar: DEFAULT_CONFIG.showSessionFeedbackLoopTopbar,
    showRemoteEntryTopbar: DEFAULT_CONFIG.showRemoteEntryTopbar,
    showTopbarRepositoryName: DEFAULT_CONFIG.showTopbarRepositoryName,
    showTopbarOpenInTerminal: DEFAULT_CONFIG.showTopbarOpenInTerminal,
    showTopbarOpenDirectory: DEFAULT_CONFIG.showTopbarOpenDirectory,
    leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
    showLeftSidebarMonitorPanel: DEFAULT_CONFIG.showLeftSidebarMonitorPanel,
    showLeftSidebarWorkspaceList: DEFAULT_CONFIG.showLeftSidebarWorkspaceList,
    workspaceListVisibleRows: DEFAULT_CONFIG.workspaceListVisibleRows,
    showRepositoryIconBadgesInWorkspaceList: DEFAULT_CONFIG.showRepositoryIconBadgesInWorkspaceList,
    monitorPanelPlacement: DEFAULT_CONFIG.monitorPanelPlacement,
    monitorPanelVisibleRows: DEFAULT_CONFIG.monitorPanelVisibleRows,
    executionEnvironmentDispatchHistoryDays: DEFAULT_CONFIG.executionEnvironmentDispatchHistoryDays,
    atMentionDefaultTarget: DEFAULT_CONFIG.atMentionDefaultTarget,
    atMentionShortcutByTarget: DEFAULT_CONFIG.atMentionShortcutByTarget,
    composerCommonPhrases: DEFAULT_CONFIG.composerCommonPhrases,
    composerDefaultInstruction: DEFAULT_CONFIG.composerDefaultInstruction,
    showComposerFooterAttachButton: DEFAULT_CONFIG.showComposerFooterAttachButton,
    showComposerFooterScreenshotButton: DEFAULT_CONFIG.showComposerFooterScreenshotButton,
    showComposerFooterVoiceButton: DEFAULT_CONFIG.showComposerFooterVoiceButton,
    showComposerFooterContextRing: DEFAULT_CONFIG.showComposerFooterContextRing,
    showComposerFooterCommonPhrases: DEFAULT_CONFIG.showComposerFooterCommonPhrases,
    showComposerFooterRuntimeSettings: DEFAULT_CONFIG.showComposerFooterRuntimeSettings,
    showComposerFooterModelPicker: DEFAULT_CONFIG.showComposerFooterModelPicker,
    composerFooterTriggerDisplayMode: DEFAULT_CONFIG.composerFooterTriggerDisplayMode,
    showWorkspaceQuickActionsPanel: DEFAULT_CONFIG.showWorkspaceQuickActionsPanel,
    showWorkspaceTodosPanel: DEFAULT_CONFIG.showWorkspaceTodosPanel,
    fileTreeOpenInNewPane: DEFAULT_CONFIG.fileTreeOpenInNewPane,
    gitPanelPlacement: DEFAULT_CONFIG.gitPanelPlacement,
    filesPanelPlacement: DEFAULT_CONFIG.filesPanelPlacement,
    repoPanelSplitMode: DEFAULT_CONFIG.repoPanelSplitMode,
    repoPanelSplitHeightPx: DEFAULT_CONFIG.repoPanelSplitHeightPx,
    sessionFeedbackLoopEnabled: DEFAULT_CONFIG.sessionFeedbackLoopEnabled,
    sessionFeedbackLoopMaxCycles: DEFAULT_CONFIG.sessionFeedbackLoopMaxCycles,
    sessionFeedbackLoopAutoStart: DEFAULT_CONFIG.sessionFeedbackLoopAutoStart,
    sessionFeedbackLoopEarlyStop: DEFAULT_CONFIG.sessionFeedbackLoopEarlyStop,
    sessionFeedbackLoopSaveHabitsToComposer: DEFAULT_CONFIG.sessionFeedbackLoopSaveHabitsToComposer,
    sessionFeedbackLoopInjectSystemPrompt: DEFAULT_CONFIG.sessionFeedbackLoopInjectSystemPrompt,
    sessionFeedbackLoopOptimizeConfigArtifacts:
      DEFAULT_CONFIG.sessionFeedbackLoopOptimizeConfigArtifacts,
    sessionFeedbackLoopGlobalRules: DEFAULT_CONFIG.sessionFeedbackLoopGlobalRules,
    sessionFeedbackLoopInjectGlobalRules: DEFAULT_CONFIG.sessionFeedbackLoopInjectGlobalRules,
    sessionFeedbackLoopAutoApplyConfigPatches:
      DEFAULT_CONFIG.sessionFeedbackLoopAutoApplyConfigPatches,
    sessionFeedbackLoopAutoRollbackOnRegression:
      DEFAULT_CONFIG.sessionFeedbackLoopAutoRollbackOnRegression,
    sessionFeedbackLoopAutoVerifyAfterApply:
      DEFAULT_CONFIG.sessionFeedbackLoopAutoVerifyAfterApply,
    showFeaturePanelHistorySessions: DEFAULT_CONFIG.showFeaturePanelHistorySessions,
    showFeaturePanelHistoryMessages: DEFAULT_CONFIG.showFeaturePanelHistoryMessages,
    showFeaturePanelScheduledTasks: DEFAULT_CONFIG.showFeaturePanelScheduledTasks,
    openInTerminalShortcut: DEFAULT_CONFIG.openInTerminalShortcut,
    openInEditorShortcut: DEFAULT_CONFIG.openInEditorShortcut,
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

function dispatchLeftSidebarWorkspaceListChanged(visible: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED, {
      detail: { showLeftSidebarWorkspaceList: visible },
    }),
  );
}

function dispatchLeftSidebarRepositoryIconBadgesChanged(visible: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_REPOSITORY_ICON_BADGES_CHANGED, {
      detail: { showRepositoryIconBadgesInWorkspaceList: visible },
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

function dispatchMonitorPanelVisibleRowsChanged(visibleRows: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_MONITOR_PANEL_VISIBLE_ROWS_CHANGED, {
      detail: { monitorPanelVisibleRows: visibleRows },
    }),
  );
}

function dispatchWorkspaceListVisibleRowsChanged(visibleRows: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_WORKSPACE_LIST_VISIBLE_ROWS_CHANGED, {
      detail: { workspaceListVisibleRows: visibleRows },
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

function dispatchRepoPanelSplitModeChanged(splitMode: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_REPO_PANEL_SPLIT_MODE_CHANGED, {
      detail: { repoPanelSplitMode: splitMode },
    }),
  );
}

function dispatchRepoPanelSplitHeightChanged(heightPx: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_REPO_PANEL_SPLIT_HEIGHT_CHANGED, {
      detail: { repoPanelSplitHeightPx: heightPx },
    }),
  );
}

function dispatchOpenInTerminalShortcutChanged(chord: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED, { detail: { chord } }),
  );
}

function dispatchOpenInEditorShortcutChanged(chord: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, { detail: { chord } }),
  );
}

function dispatchSessionFeedbackLoopChanged(settings: SessionFeedbackLoopSettings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_SESSION_FEEDBACK_LOOP_CHANGED, { detail: settings }),
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
  return await maybeUpgradeOneshotDefaultToStreaming(resolved);
}

export async function saveWiseDefaultConfig(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "connectionKind"
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showOpencodeProxyTopbar"
      | "showSessionDataLinkTopbar"
      | "showSessionFeedbackLoopTopbar"
      | "showRemoteEntryTopbar"
      | "showTopbarRepositoryName"
      | "showTopbarOpenInTerminal"
      | "showTopbarOpenDirectory"
      | "leftSidebarHubQuickEntries"
      | "showLeftSidebarMonitorPanel"
      | "showLeftSidebarWorkspaceList"
      | "workspaceListVisibleRows"
      | "showRepositoryIconBadgesInWorkspaceList"
      | "monitorPanelPlacement"
      | "monitorPanelVisibleRows"
      | "executionEnvironmentDispatchHistoryDays"
      | "atMentionDefaultTarget"
      | "atMentionShortcutByTarget"
      | "composerCommonPhrases"
      | "composerDefaultInstruction"
      | "showComposerFooterAttachButton"
      | "showComposerFooterScreenshotButton"
      | "showComposerFooterVoiceButton"
      | "showComposerFooterContextRing"
      | "showComposerFooterCommonPhrases"
      | "showComposerFooterRuntimeSettings"
      | "showComposerFooterModelPicker"
      | "composerFooterTriggerDisplayMode"
      | "showFeaturePanelHistorySessions"
      | "showFeaturePanelHistoryMessages"
      | "showFeaturePanelScheduledTasks"
      | "showWorkspaceQuickActionsPanel"
      | "showWorkspaceTodosPanel"
      | "fileTreeOpenInNewPane"
      | "gitPanelPlacement"
      | "filesPanelPlacement"
      | "repoPanelSplitMode"
      | "repoPanelSplitHeightPx"
      | "sessionFeedbackLoopEnabled"
      | "sessionFeedbackLoopMaxCycles"
      | "sessionFeedbackLoopAutoStart"
      | "sessionFeedbackLoopEarlyStop"
      | "sessionFeedbackLoopSaveHabitsToComposer"
      | "sessionFeedbackLoopInjectSystemPrompt"
      | "sessionFeedbackLoopOptimizeConfigArtifacts"
      | "sessionFeedbackLoopGlobalRules"
      | "sessionFeedbackLoopInjectGlobalRules"
      | "sessionFeedbackLoopAutoApplyConfigPatches"
      | "sessionFeedbackLoopAutoRollbackOnRegression"
      | "sessionFeedbackLoopAutoVerifyAfterApply"
      | "openInTerminalShortcut"
      | "openInEditorShortcut"
    >
  >,
): Promise<WiseDefaultConfigV1> {
  const current = await loadWiseDefaultConfig();
  const next: WiseDefaultConfigV1 = {
    version: 1,
    connectionKind: patch.connectionKind ?? current.connectionKind,
    showLlmProxyTopbar: patch.showLlmProxyTopbar ?? current.showLlmProxyTopbar,
    showFccTopbar: patch.showFccTopbar ?? current.showFccTopbar,
    showFccTrafficTopbar: patch.showFccTrafficTopbar ?? current.showFccTrafficTopbar,
    showOpencodeProxyTopbar: patch.showOpencodeProxyTopbar ?? current.showOpencodeProxyTopbar,
    showSessionDataLinkTopbar:
      patch.showSessionDataLinkTopbar ?? current.showSessionDataLinkTopbar,
    showSessionFeedbackLoopTopbar:
      patch.showSessionFeedbackLoopTopbar ?? current.showSessionFeedbackLoopTopbar,
    showRemoteEntryTopbar: patch.showRemoteEntryTopbar ?? current.showRemoteEntryTopbar,
    showTopbarRepositoryName: patch.showTopbarRepositoryName ?? current.showTopbarRepositoryName,
    showTopbarOpenInTerminal:
      patch.showTopbarOpenInTerminal ?? current.showTopbarOpenInTerminal,
    showTopbarOpenDirectory:
      patch.showTopbarOpenDirectory ?? current.showTopbarOpenDirectory,
    leftSidebarHubQuickEntries:
      patch.leftSidebarHubQuickEntries !== undefined
        ? normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries)
        : current.leftSidebarHubQuickEntries,
    showLeftSidebarMonitorPanel:
      patch.showLeftSidebarMonitorPanel ?? current.showLeftSidebarMonitorPanel,
    showLeftSidebarWorkspaceList:
      patch.showLeftSidebarWorkspaceList ?? current.showLeftSidebarWorkspaceList,
    workspaceListVisibleRows: patch.workspaceListVisibleRows ?? current.workspaceListVisibleRows,
    showRepositoryIconBadgesInWorkspaceList:
      patch.showRepositoryIconBadgesInWorkspaceList ?? current.showRepositoryIconBadgesInWorkspaceList,
    monitorPanelPlacement: patch.monitorPanelPlacement ?? current.monitorPanelPlacement,
    monitorPanelVisibleRows: patch.monitorPanelVisibleRows ?? current.monitorPanelVisibleRows,
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
    composerDefaultInstruction:
      patch.composerDefaultInstruction !== undefined
        ? patch.composerDefaultInstruction.trim()
        : current.composerDefaultInstruction,
    showComposerFooterAttachButton:
      patch.showComposerFooterAttachButton ?? current.showComposerFooterAttachButton,
    showComposerFooterScreenshotButton:
      patch.showComposerFooterScreenshotButton ?? current.showComposerFooterScreenshotButton,
    showComposerFooterVoiceButton:
      patch.showComposerFooterVoiceButton ?? current.showComposerFooterVoiceButton,
    showComposerFooterContextRing:
      patch.showComposerFooterContextRing ?? current.showComposerFooterContextRing,
    showComposerFooterCommonPhrases:
      patch.showComposerFooterCommonPhrases ?? current.showComposerFooterCommonPhrases,
    showComposerFooterRuntimeSettings:
      patch.showComposerFooterRuntimeSettings ?? current.showComposerFooterRuntimeSettings,
    showComposerFooterModelPicker:
      patch.showComposerFooterModelPicker ?? current.showComposerFooterModelPicker,
    composerFooterTriggerDisplayMode:
      patch.composerFooterTriggerDisplayMode !== undefined
        ? normalizeComposerFooterTriggerDisplayMode(patch.composerFooterTriggerDisplayMode)
        : current.composerFooterTriggerDisplayMode,
    showWorkspaceQuickActionsPanel:
      patch.showWorkspaceQuickActionsPanel ?? current.showWorkspaceQuickActionsPanel,
    showWorkspaceTodosPanel: patch.showWorkspaceTodosPanel ?? current.showWorkspaceTodosPanel,
    fileTreeOpenInNewPane: patch.fileTreeOpenInNewPane ?? current.fileTreeOpenInNewPane,
    gitPanelPlacement: patch.gitPanelPlacement ?? current.gitPanelPlacement,
    filesPanelPlacement: patch.filesPanelPlacement ?? current.filesPanelPlacement,
    repoPanelSplitMode:
      patch.repoPanelSplitMode ?? current.repoPanelSplitMode,
    repoPanelSplitHeightPx:
      patch.repoPanelSplitHeightPx ?? current.repoPanelSplitHeightPx,
    sessionFeedbackLoopEnabled:
      patch.sessionFeedbackLoopEnabled ?? current.sessionFeedbackLoopEnabled,
    sessionFeedbackLoopMaxCycles:
      patch.sessionFeedbackLoopMaxCycles ?? current.sessionFeedbackLoopMaxCycles,
    sessionFeedbackLoopAutoStart:
      patch.sessionFeedbackLoopAutoStart ?? current.sessionFeedbackLoopAutoStart,
    sessionFeedbackLoopEarlyStop:
      patch.sessionFeedbackLoopEarlyStop ?? current.sessionFeedbackLoopEarlyStop,
    sessionFeedbackLoopSaveHabitsToComposer:
      patch.sessionFeedbackLoopSaveHabitsToComposer ?? current.sessionFeedbackLoopSaveHabitsToComposer,
    sessionFeedbackLoopInjectSystemPrompt:
      patch.sessionFeedbackLoopInjectSystemPrompt ?? current.sessionFeedbackLoopInjectSystemPrompt,
    sessionFeedbackLoopOptimizeConfigArtifacts:
      patch.sessionFeedbackLoopOptimizeConfigArtifacts ??
      current.sessionFeedbackLoopOptimizeConfigArtifacts,
    sessionFeedbackLoopGlobalRules:
      patch.sessionFeedbackLoopGlobalRules !== undefined
        ? normalizeFeedbackGlobalRules(patch.sessionFeedbackLoopGlobalRules)
        : current.sessionFeedbackLoopGlobalRules,
    sessionFeedbackLoopInjectGlobalRules:
      patch.sessionFeedbackLoopInjectGlobalRules ??
      current.sessionFeedbackLoopInjectGlobalRules,
    sessionFeedbackLoopAutoApplyConfigPatches:
      patch.sessionFeedbackLoopAutoApplyConfigPatches ??
      current.sessionFeedbackLoopAutoApplyConfigPatches,
    sessionFeedbackLoopAutoRollbackOnRegression:
      patch.sessionFeedbackLoopAutoRollbackOnRegression ??
      current.sessionFeedbackLoopAutoRollbackOnRegression,
    sessionFeedbackLoopAutoVerifyAfterApply:
      patch.sessionFeedbackLoopAutoVerifyAfterApply ??
      current.sessionFeedbackLoopAutoVerifyAfterApply,
    showFeaturePanelHistorySessions:
      patch.showFeaturePanelHistorySessions ?? current.showFeaturePanelHistorySessions,
    showFeaturePanelHistoryMessages:
      patch.showFeaturePanelHistoryMessages ?? current.showFeaturePanelHistoryMessages,
    showFeaturePanelScheduledTasks:
      patch.showFeaturePanelScheduledTasks ?? current.showFeaturePanelScheduledTasks,
    openInTerminalShortcut:
      patch.openInTerminalShortcut !== undefined
        ? normalizeChord(patch.openInTerminalShortcut)
        : current.openInTerminalShortcut,
    openInEditorShortcut:
      patch.openInEditorShortcut !== undefined
        ? normalizeChord(patch.openInEditorShortcut)
        : current.openInEditorShortcut,
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
  if (patch.showOpencodeProxyTopbar !== undefined) {
    next.showOpencodeProxyTopbar = normalizeBoolean(patch.showOpencodeProxyTopbar);
  }
  if (patch.showSessionDataLinkTopbar !== undefined) {
    next.showSessionDataLinkTopbar = normalizeBoolean(patch.showSessionDataLinkTopbar);
  }
  if (patch.showSessionFeedbackLoopTopbar !== undefined) {
    next.showSessionFeedbackLoopTopbar = normalizeBoolean(patch.showSessionFeedbackLoopTopbar);
  }
  if (patch.showRemoteEntryTopbar !== undefined) {
    next.showRemoteEntryTopbar = normalizeBoolean(
      patch.showRemoteEntryTopbar,
      DEFAULT_CONFIG.showRemoteEntryTopbar,
    );
  }
  if (patch.showTopbarRepositoryName !== undefined) {
    next.showTopbarRepositoryName = normalizeBoolean(
      patch.showTopbarRepositoryName,
      DEFAULT_CONFIG.showTopbarRepositoryName,
    );
  }
  if (patch.showTopbarOpenInTerminal !== undefined) {
    next.showTopbarOpenInTerminal = normalizeBoolean(
      patch.showTopbarOpenInTerminal,
      DEFAULT_CONFIG.showTopbarOpenInTerminal,
    );
  }
  if (patch.showTopbarOpenDirectory !== undefined) {
    next.showTopbarOpenDirectory = normalizeBoolean(
      patch.showTopbarOpenDirectory,
      DEFAULT_CONFIG.showTopbarOpenDirectory,
    );
  }
  if (patch.leftSidebarHubQuickEntries !== undefined) {
    next.leftSidebarHubQuickEntries = normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries);
  }
  if (patch.showLeftSidebarMonitorPanel !== undefined) {
    next.showLeftSidebarMonitorPanel = normalizeBoolean(patch.showLeftSidebarMonitorPanel);
  }
  if (patch.showLeftSidebarWorkspaceList !== undefined) {
    next.showLeftSidebarWorkspaceList = normalizeBoolean(patch.showLeftSidebarWorkspaceList);
  }
  if (patch.workspaceListVisibleRows !== undefined) {
    next.workspaceListVisibleRows = normalizeWorkspaceListVisibleRows(patch.workspaceListVisibleRows);
  }
  if (patch.showRepositoryIconBadgesInWorkspaceList !== undefined) {
    next.showRepositoryIconBadgesInWorkspaceList = normalizeBoolean(
      patch.showRepositoryIconBadgesInWorkspaceList,
    );
  }
  if (patch.monitorPanelPlacement !== undefined) {
    next.monitorPanelPlacement =
      normalizeMonitorPanelPlacement(patch.monitorPanelPlacement) ?? current.monitorPanelPlacement;
  }
  if (patch.monitorPanelVisibleRows !== undefined) {
    next.monitorPanelVisibleRows = normalizeMonitorPanelVisibleRows(patch.monitorPanelVisibleRows);
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
  if (patch.showComposerFooterAttachButton !== undefined) {
    next.showComposerFooterAttachButton = normalizeBoolean(
      patch.showComposerFooterAttachButton,
      DEFAULT_CONFIG.showComposerFooterAttachButton,
    );
  }
  if (patch.showComposerFooterScreenshotButton !== undefined) {
    next.showComposerFooterScreenshotButton = normalizeBoolean(
      patch.showComposerFooterScreenshotButton,
      DEFAULT_CONFIG.showComposerFooterScreenshotButton,
    );
  }
  if (patch.showComposerFooterVoiceButton !== undefined) {
    next.showComposerFooterVoiceButton = normalizeBoolean(
      patch.showComposerFooterVoiceButton,
      DEFAULT_CONFIG.showComposerFooterVoiceButton,
    );
  }
  if (patch.showComposerFooterContextRing !== undefined) {
    next.showComposerFooterContextRing = normalizeBoolean(
      patch.showComposerFooterContextRing,
      DEFAULT_CONFIG.showComposerFooterContextRing,
    );
  }
  if (patch.showComposerFooterCommonPhrases !== undefined) {
    next.showComposerFooterCommonPhrases = normalizeBoolean(
      patch.showComposerFooterCommonPhrases,
      DEFAULT_CONFIG.showComposerFooterCommonPhrases,
    );
  }
  if (patch.showComposerFooterRuntimeSettings !== undefined) {
    next.showComposerFooterRuntimeSettings = normalizeBoolean(
      patch.showComposerFooterRuntimeSettings,
      DEFAULT_CONFIG.showComposerFooterRuntimeSettings,
    );
  }
  if (patch.showComposerFooterModelPicker !== undefined) {
    next.showComposerFooterModelPicker = normalizeBoolean(
      patch.showComposerFooterModelPicker,
      DEFAULT_CONFIG.showComposerFooterModelPicker,
    );
  }
  if (patch.showWorkspaceQuickActionsPanel !== undefined) {
    next.showWorkspaceQuickActionsPanel = normalizeBoolean(patch.showWorkspaceQuickActionsPanel);
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
  if (patch.repoPanelSplitMode !== undefined) {
    next.repoPanelSplitMode = normalizeBoolean(patch.repoPanelSplitMode);
  }
  if (patch.repoPanelSplitHeightPx !== undefined) {
    next.repoPanelSplitHeightPx = clampRepoPanelSplitHeightPx(patch.repoPanelSplitHeightPx);
  }
  if (patch.sessionFeedbackLoopEnabled !== undefined) {
    next.sessionFeedbackLoopEnabled = normalizeBoolean(
      patch.sessionFeedbackLoopEnabled,
      DEFAULT_CONFIG.sessionFeedbackLoopEnabled,
    );
  }
  if (patch.sessionFeedbackLoopMaxCycles !== undefined) {
    next.sessionFeedbackLoopMaxCycles = normalizeFeedbackLoopMaxCycles(patch.sessionFeedbackLoopMaxCycles);
  }
  if (patch.sessionFeedbackLoopAutoStart !== undefined) {
    next.sessionFeedbackLoopAutoStart = normalizeBoolean(
      patch.sessionFeedbackLoopAutoStart,
      DEFAULT_CONFIG.sessionFeedbackLoopAutoStart,
    );
  }
  if (patch.sessionFeedbackLoopEarlyStop !== undefined) {
    next.sessionFeedbackLoopEarlyStop = normalizeBoolean(
      patch.sessionFeedbackLoopEarlyStop,
      DEFAULT_CONFIG.sessionFeedbackLoopEarlyStop,
    );
  }
  if (patch.sessionFeedbackLoopSaveHabitsToComposer !== undefined) {
    next.sessionFeedbackLoopSaveHabitsToComposer = normalizeBoolean(
      patch.sessionFeedbackLoopSaveHabitsToComposer,
      DEFAULT_CONFIG.sessionFeedbackLoopSaveHabitsToComposer,
    );
  }
  if (patch.sessionFeedbackLoopInjectSystemPrompt !== undefined) {
    next.sessionFeedbackLoopInjectSystemPrompt = normalizeBoolean(
      patch.sessionFeedbackLoopInjectSystemPrompt,
      DEFAULT_CONFIG.sessionFeedbackLoopInjectSystemPrompt,
    );
  }
  if (patch.sessionFeedbackLoopOptimizeConfigArtifacts !== undefined) {
    next.sessionFeedbackLoopOptimizeConfigArtifacts = normalizeBoolean(
      patch.sessionFeedbackLoopOptimizeConfigArtifacts,
      DEFAULT_CONFIG.sessionFeedbackLoopOptimizeConfigArtifacts,
    );
  }
  if (patch.sessionFeedbackLoopAutoApplyConfigPatches !== undefined) {
    next.sessionFeedbackLoopAutoApplyConfigPatches = normalizeBoolean(
      patch.sessionFeedbackLoopAutoApplyConfigPatches,
      DEFAULT_CONFIG.sessionFeedbackLoopAutoApplyConfigPatches,
    );
  }
  if (patch.sessionFeedbackLoopAutoRollbackOnRegression !== undefined) {
    next.sessionFeedbackLoopAutoRollbackOnRegression = normalizeBoolean(
      patch.sessionFeedbackLoopAutoRollbackOnRegression,
      DEFAULT_CONFIG.sessionFeedbackLoopAutoRollbackOnRegression,
    );
  }
  if (patch.sessionFeedbackLoopAutoVerifyAfterApply !== undefined) {
    next.sessionFeedbackLoopAutoVerifyAfterApply = normalizeBoolean(
      patch.sessionFeedbackLoopAutoVerifyAfterApply,
      DEFAULT_CONFIG.sessionFeedbackLoopAutoVerifyAfterApply,
    );
  }
  if (patch.openInTerminalShortcut !== undefined) {
    next.openInTerminalShortcut = normalizeChord(patch.openInTerminalShortcut);
  }
  if (patch.openInEditorShortcut !== undefined) {
    next.openInEditorShortcut = normalizeChord(patch.openInEditorShortcut);
  }
  await persistConfig(next);
  await deleteLegacyAppSettings();

  if (patch.connectionKind !== undefined && next.connectionKind !== current.connectionKind) {
    dispatchConnectionKindChanged(next.connectionKind);
  }
  if (
    patch.showLlmProxyTopbar !== undefined ||
    patch.showFccTopbar !== undefined ||
    patch.showFccTrafficTopbar !== undefined ||
    patch.showOpencodeProxyTopbar !== undefined ||
    patch.showSessionDataLinkTopbar !== undefined ||
    patch.showSessionFeedbackLoopTopbar !== undefined ||
    patch.showRemoteEntryTopbar !== undefined ||
    patch.showTopbarRepositoryName !== undefined ||
    patch.showTopbarOpenInTerminal !== undefined ||
    patch.showTopbarOpenDirectory !== undefined
  ) {
    if (
      next.showLlmProxyTopbar !== current.showLlmProxyTopbar ||
      next.showFccTopbar !== current.showFccTopbar ||
      next.showFccTrafficTopbar !== current.showFccTrafficTopbar ||
      next.showOpencodeProxyTopbar !== current.showOpencodeProxyTopbar ||
      next.showSessionDataLinkTopbar !== current.showSessionDataLinkTopbar ||
      next.showSessionFeedbackLoopTopbar !== current.showSessionFeedbackLoopTopbar ||
      next.showRemoteEntryTopbar !== current.showRemoteEntryTopbar ||
      next.showTopbarRepositoryName !== current.showTopbarRepositoryName ||
      next.showTopbarOpenInTerminal !== current.showTopbarOpenInTerminal ||
      next.showTopbarOpenDirectory !== current.showTopbarOpenDirectory
    ) {
      dispatchTopbarChromeDefaultChanged({
        showLlmProxyTopbar: next.showLlmProxyTopbar,
        showFccTopbar: next.showFccTopbar,
        showFccTrafficTopbar: next.showFccTrafficTopbar,
        showOpencodeProxyTopbar: next.showOpencodeProxyTopbar,
        showSessionDataLinkTopbar: next.showSessionDataLinkTopbar,
        showSessionFeedbackLoopTopbar: next.showSessionFeedbackLoopTopbar,
        showRemoteEntryTopbar: next.showRemoteEntryTopbar,
        showTopbarRepositoryName: next.showTopbarRepositoryName,
        showTopbarOpenInTerminal: next.showTopbarOpenInTerminal,
        showTopbarOpenDirectory: next.showTopbarOpenDirectory,
      });
    }
  }
  if (
    patch.showComposerFooterAttachButton !== undefined ||
    patch.showComposerFooterScreenshotButton !== undefined ||
    patch.showComposerFooterVoiceButton !== undefined ||
    patch.showComposerFooterContextRing !== undefined ||
    patch.showComposerFooterCommonPhrases !== undefined ||
    patch.showComposerFooterRuntimeSettings !== undefined ||
    patch.showComposerFooterModelPicker !== undefined ||
    patch.composerFooterTriggerDisplayMode !== undefined
  ) {
    if (
      next.showComposerFooterAttachButton !== current.showComposerFooterAttachButton ||
      next.showComposerFooterScreenshotButton !== current.showComposerFooterScreenshotButton ||
      next.showComposerFooterVoiceButton !== current.showComposerFooterVoiceButton ||
      next.showComposerFooterContextRing !== current.showComposerFooterContextRing ||
      next.showComposerFooterCommonPhrases !== current.showComposerFooterCommonPhrases ||
      next.showComposerFooterRuntimeSettings !== current.showComposerFooterRuntimeSettings ||
      next.showComposerFooterModelPicker !== current.showComposerFooterModelPicker ||
      next.composerFooterTriggerDisplayMode !== current.composerFooterTriggerDisplayMode
    ) {
      dispatchComposerFooterChromeDefaultChanged({
        showComposerFooterAttachButton: next.showComposerFooterAttachButton,
        showComposerFooterScreenshotButton: next.showComposerFooterScreenshotButton,
        showComposerFooterVoiceButton: next.showComposerFooterVoiceButton,
        showComposerFooterContextRing: next.showComposerFooterContextRing,
        showComposerFooterCommonPhrases: next.showComposerFooterCommonPhrases,
        showComposerFooterRuntimeSettings: next.showComposerFooterRuntimeSettings,
        showComposerFooterModelPicker: next.showComposerFooterModelPicker,
        composerFooterTriggerDisplayMode: next.composerFooterTriggerDisplayMode,
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
    patch.showLeftSidebarWorkspaceList !== undefined &&
    next.showLeftSidebarWorkspaceList !== current.showLeftSidebarWorkspaceList
  ) {
    dispatchLeftSidebarWorkspaceListChanged(next.showLeftSidebarWorkspaceList);
  }
  if (
    patch.workspaceListVisibleRows !== undefined &&
    next.workspaceListVisibleRows !== current.workspaceListVisibleRows
  ) {
    dispatchWorkspaceListVisibleRowsChanged(next.workspaceListVisibleRows);
  }
  if (
    patch.showRepositoryIconBadgesInWorkspaceList !== undefined &&
    next.showRepositoryIconBadgesInWorkspaceList !== current.showRepositoryIconBadgesInWorkspaceList
  ) {
    dispatchLeftSidebarRepositoryIconBadgesChanged(next.showRepositoryIconBadgesInWorkspaceList);
  }
  if (
    patch.monitorPanelPlacement !== undefined &&
    next.monitorPanelPlacement !== current.monitorPanelPlacement
  ) {
    dispatchMonitorPanelPlacementChanged(next.monitorPanelPlacement);
  }
  if (
    patch.monitorPanelVisibleRows !== undefined &&
    next.monitorPanelVisibleRows !== current.monitorPanelVisibleRows
  ) {
    dispatchMonitorPanelVisibleRowsChanged(next.monitorPanelVisibleRows);
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
    patch.showWorkspaceTodosPanel !== undefined
  ) {
    if (
      next.showWorkspaceQuickActionsPanel !== current.showWorkspaceQuickActionsPanel ||
      next.showWorkspaceTodosPanel !== current.showWorkspaceTodosPanel
    ) {
      dispatchWorkspaceInspectorPanelsChanged({
        showWorkspaceQuickActionsPanel: next.showWorkspaceQuickActionsPanel,
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
  if (
    patch.openInTerminalShortcut !== undefined &&
    next.openInTerminalShortcut !== current.openInTerminalShortcut
  ) {
    dispatchOpenInTerminalShortcutChanged(next.openInTerminalShortcut);
  }
  if (
    patch.openInEditorShortcut !== undefined &&
    next.openInEditorShortcut !== current.openInEditorShortcut
  ) {
    dispatchOpenInEditorShortcutChanged(next.openInEditorShortcut);
  }
  if (
    patch.sessionFeedbackLoopEnabled !== undefined ||
    patch.sessionFeedbackLoopMaxCycles !== undefined ||
    patch.sessionFeedbackLoopAutoStart !== undefined ||
    patch.sessionFeedbackLoopEarlyStop !== undefined ||
    patch.sessionFeedbackLoopSaveHabitsToComposer !== undefined ||
    patch.sessionFeedbackLoopInjectSystemPrompt !== undefined ||
    patch.sessionFeedbackLoopOptimizeConfigArtifacts !== undefined ||
    patch.sessionFeedbackLoopGlobalRules !== undefined ||
    patch.sessionFeedbackLoopInjectGlobalRules !== undefined ||
    patch.sessionFeedbackLoopAutoApplyConfigPatches !== undefined ||
    patch.sessionFeedbackLoopAutoRollbackOnRegression !== undefined ||
    patch.sessionFeedbackLoopAutoVerifyAfterApply !== undefined
  ) {
    if (
      next.sessionFeedbackLoopEnabled !== current.sessionFeedbackLoopEnabled ||
      next.sessionFeedbackLoopMaxCycles !== current.sessionFeedbackLoopMaxCycles ||
      next.sessionFeedbackLoopAutoStart !== current.sessionFeedbackLoopAutoStart ||
      next.sessionFeedbackLoopEarlyStop !== current.sessionFeedbackLoopEarlyStop ||
      next.sessionFeedbackLoopSaveHabitsToComposer !==
        current.sessionFeedbackLoopSaveHabitsToComposer ||
      next.sessionFeedbackLoopInjectSystemPrompt !== current.sessionFeedbackLoopInjectSystemPrompt ||
      next.sessionFeedbackLoopOptimizeConfigArtifacts !==
        current.sessionFeedbackLoopOptimizeConfigArtifacts ||
      JSON.stringify(next.sessionFeedbackLoopGlobalRules) !==
        JSON.stringify(current.sessionFeedbackLoopGlobalRules) ||
      next.sessionFeedbackLoopInjectGlobalRules !== current.sessionFeedbackLoopInjectGlobalRules ||
      next.sessionFeedbackLoopAutoApplyConfigPatches !==
        current.sessionFeedbackLoopAutoApplyConfigPatches ||
      next.sessionFeedbackLoopAutoRollbackOnRegression !==
        current.sessionFeedbackLoopAutoRollbackOnRegression ||
      next.sessionFeedbackLoopAutoVerifyAfterApply !==
        current.sessionFeedbackLoopAutoVerifyAfterApply
    ) {
      dispatchSessionFeedbackLoopChanged({
        enabled: next.sessionFeedbackLoopEnabled,
        maxCycles: next.sessionFeedbackLoopMaxCycles,
        autoStart: next.sessionFeedbackLoopAutoStart,
        earlyStopConvergence: next.sessionFeedbackLoopEarlyStop,
        autoSaveHabitsToComposer: next.sessionFeedbackLoopSaveHabitsToComposer,
        injectHabitsToSystemPrompt: next.sessionFeedbackLoopInjectSystemPrompt,
        optimizeConfigArtifacts: next.sessionFeedbackLoopOptimizeConfigArtifacts,
        globalRules: next.sessionFeedbackLoopGlobalRules,
        injectGlobalRules: next.sessionFeedbackLoopInjectGlobalRules,
        autoApplyConfigPatches: next.sessionFeedbackLoopAutoApplyConfigPatches,
        autoRollbackOnRegression: next.sessionFeedbackLoopAutoRollbackOnRegression,
        autoVerifyAfterApply: next.sessionFeedbackLoopAutoVerifyAfterApply,
      });
    }
  }
  if (
    patch.showFeaturePanelHistorySessions !== undefined ||
    patch.showFeaturePanelHistoryMessages !== undefined ||
    patch.showFeaturePanelScheduledTasks !== undefined
  ) {
    if (
      next.showFeaturePanelHistorySessions !== current.showFeaturePanelHistorySessions ||
      next.showFeaturePanelHistoryMessages !== current.showFeaturePanelHistoryMessages ||
      next.showFeaturePanelScheduledTasks !== current.showFeaturePanelScheduledTasks
    ) {
      dispatchFeaturePanelChromeDefaultChanged({
        showFeaturePanelHistorySessions: next.showFeaturePanelHistorySessions,
        showFeaturePanelHistoryMessages: next.showFeaturePanelHistoryMessages,
        showFeaturePanelScheduledTasks: next.showFeaturePanelScheduledTasks,
      });
    }
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

export async function loadOpenInTerminalShortcutFromStore(): Promise<string> {
  return (await loadWiseDefaultConfig()).openInTerminalShortcut;
}

export async function saveOpenInTerminalShortcutToStore(chord: string): Promise<string> {
  const normalized = normalizeChord(chord);
  await saveWiseDefaultConfig({ openInTerminalShortcut: normalized });
  return normalized;
}

export async function loadOpenInEditorShortcutFromStore(): Promise<string> {
  return (await loadWiseDefaultConfig()).openInEditorShortcut;
}

export async function saveOpenInEditorShortcutToStore(chord: string): Promise<string> {
  const normalized = normalizeChord(chord);
  await saveWiseDefaultConfig({ openInEditorShortcut: normalized });
  return normalized;
}

export async function loadComposerDefaultInstructionFromStore(): Promise<string> {
  return (await loadWiseDefaultConfig()).composerDefaultInstruction;
}

export async function saveComposerDefaultInstructionToStore(text: string): Promise<string> {
  const normalized = text.trim();
  await saveWiseDefaultConfig({ composerDefaultInstruction: normalized });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(WISE_COMPOSER_DEFAULT_INSTRUCTION_CHANGED, {
        detail: { composerDefaultInstruction: normalized },
      }),
    );
  }
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

export async function loadLeftSidebarWorkspaceListVisibleFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).showLeftSidebarWorkspaceList;
}

export async function saveLeftSidebarWorkspaceListVisibleToStore(visible: boolean): Promise<void> {
  await saveWiseDefaultConfig({ showLeftSidebarWorkspaceList: visible });
}

export async function loadWorkspaceListVisibleRowsFromStore(): Promise<number> {
  return (await loadWiseDefaultConfig()).workspaceListVisibleRows;
}

export async function saveWorkspaceListVisibleRowsToStore(visibleRows: number): Promise<void> {
  const normalized = normalizeWorkspaceListVisibleRows(visibleRows);
  await saveWiseDefaultConfig({ workspaceListVisibleRows: normalized });
}

export async function loadLeftSidebarWorkspaceListDefaultFromStore(): Promise<{
  visible: boolean;
  visibleRows: number;
}> {
  const config = await loadWiseDefaultConfig();
  return {
    visible: config.showLeftSidebarWorkspaceList,
    visibleRows: config.workspaceListVisibleRows,
  };
}

export async function loadRepositoryIconBadgesVisibleInWorkspaceListFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).showRepositoryIconBadgesInWorkspaceList;
}

export async function saveRepositoryIconBadgesVisibleInWorkspaceListToStore(
  visible: boolean,
): Promise<void> {
  await saveWiseDefaultConfig({ showRepositoryIconBadgesInWorkspaceList: visible });
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

export async function loadMonitorPanelVisibleRowsFromStore(): Promise<number> {
  return (await loadWiseDefaultConfig()).monitorPanelVisibleRows;
}

export async function saveMonitorPanelVisibleRowsToStore(visibleRows: number): Promise<void> {
  const normalized = normalizeMonitorPanelVisibleRows(visibleRows);
  await saveWiseDefaultConfig({ monitorPanelVisibleRows: normalized });
}

export async function loadMonitorPanelDefaultFromStore(): Promise<{
  visible: boolean;
  placement: MonitorPanelPlacement;
  visibleRows: number;
}> {
  const config = await loadWiseDefaultConfig();
  return {
    visible: config.showLeftSidebarMonitorPanel,
    placement: config.monitorPanelPlacement,
    visibleRows: config.monitorPanelVisibleRows,
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

export async function loadRepoPanelSplitModeFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).repoPanelSplitMode;
}

export async function saveRepoPanelSplitModeToStore(splitMode: boolean): Promise<void> {
  await saveWiseDefaultConfig({ repoPanelSplitMode: splitMode });
  dispatchRepoPanelSplitModeChanged(splitMode);
}

export async function loadRepoPanelSplitHeightFromStore(): Promise<number> {
  return (await loadWiseDefaultConfig()).repoPanelSplitHeightPx;
}

export async function saveRepoPanelSplitHeightToStore(heightPx: number): Promise<void> {
  const clamped = clampRepoPanelSplitHeightPx(heightPx);
  await saveWiseDefaultConfig({ repoPanelSplitHeightPx: clamped });
  dispatchRepoPanelSplitHeightChanged(clamped);
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

export async function loadTopbarChromeDefaultsFromStore(): Promise<
  Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showOpencodeProxyTopbar"
    | "showSessionDataLinkTopbar"
    | "showSessionFeedbackLoopTopbar"
    | "showRemoteEntryTopbar"
    | "showTopbarRepositoryName"
    | "showTopbarOpenInTerminal"
    | "showTopbarOpenDirectory"
  >
> {
  const config = await loadWiseDefaultConfig();
  return {
    showLlmProxyTopbar: config.showLlmProxyTopbar,
    showFccTopbar: config.showFccTopbar,
    showFccTrafficTopbar: config.showFccTrafficTopbar,
    showOpencodeProxyTopbar: config.showOpencodeProxyTopbar,
    showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
    showSessionFeedbackLoopTopbar: config.showSessionFeedbackLoopTopbar,
    showRemoteEntryTopbar: config.showRemoteEntryTopbar,
    showTopbarRepositoryName: config.showTopbarRepositoryName,
    showTopbarOpenInTerminal: config.showTopbarOpenInTerminal,
    showTopbarOpenDirectory: config.showTopbarOpenDirectory,
  };
}

export async function saveTopbarChromeDefaultsToStore(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showOpencodeProxyTopbar"
      | "showSessionDataLinkTopbar"
      | "showSessionFeedbackLoopTopbar"
      | "showRemoteEntryTopbar"
      | "showTopbarRepositoryName"
      | "showTopbarOpenInTerminal"
      | "showTopbarOpenDirectory"
    >
  >,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}

export async function loadComposerFooterChromeDefaultsFromStore(): Promise<ComposerFooterChromeDefaults> {
  const config = await loadWiseDefaultConfig();
  return {
    showComposerFooterAttachButton: config.showComposerFooterAttachButton,
    showComposerFooterScreenshotButton: config.showComposerFooterScreenshotButton,
    showComposerFooterVoiceButton: config.showComposerFooterVoiceButton,
    showComposerFooterContextRing: config.showComposerFooterContextRing,
    showComposerFooterCommonPhrases: config.showComposerFooterCommonPhrases,
    showComposerFooterRuntimeSettings: config.showComposerFooterRuntimeSettings,
    showComposerFooterModelPicker: config.showComposerFooterModelPicker,
    composerFooterTriggerDisplayMode: config.composerFooterTriggerDisplayMode,
  };
}

export async function saveComposerFooterChromeDefaultsToStore(
  patch: Partial<ComposerFooterChromeDefaults>,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}

export async function loadFeaturePanelChromeDefaultsFromStore(): Promise<FeaturePanelChromeDefaults> {
  const config = await loadWiseDefaultConfig();
  return {
    showFeaturePanelHistorySessions: config.showFeaturePanelHistorySessions,
    showFeaturePanelHistoryMessages: config.showFeaturePanelHistoryMessages,
    showFeaturePanelScheduledTasks: config.showFeaturePanelScheduledTasks,
  };
}

export async function saveFeaturePanelChromeDefaultsToStore(
  patch: Partial<FeaturePanelChromeDefaults>,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}

export async function loadWorkspaceInspectorPanelsFromStore(): Promise<WorkspaceInspectorPanelsDefaults> {
  const config = await loadWiseDefaultConfig();
  return {
    showWorkspaceQuickActionsPanel: config.showWorkspaceQuickActionsPanel,
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

export async function loadSessionFeedbackLoopSettingsFromStore(): Promise<SessionFeedbackLoopSettings> {
  const config = await loadWiseDefaultConfig();
  return {
    enabled: config.sessionFeedbackLoopEnabled,
    maxCycles: config.sessionFeedbackLoopMaxCycles,
    autoStart: config.sessionFeedbackLoopAutoStart,
    earlyStopConvergence: config.sessionFeedbackLoopEarlyStop,
    autoSaveHabitsToComposer: config.sessionFeedbackLoopSaveHabitsToComposer,
    injectHabitsToSystemPrompt: config.sessionFeedbackLoopInjectSystemPrompt,
    optimizeConfigArtifacts: config.sessionFeedbackLoopOptimizeConfigArtifacts,
    globalRules: config.sessionFeedbackLoopGlobalRules,
    injectGlobalRules: config.sessionFeedbackLoopInjectGlobalRules,
    autoApplyConfigPatches: config.sessionFeedbackLoopAutoApplyConfigPatches,
    autoRollbackOnRegression: config.sessionFeedbackLoopAutoRollbackOnRegression,
    autoVerifyAfterApply: config.sessionFeedbackLoopAutoVerifyAfterApply,
  };
}

export async function saveSessionFeedbackLoopSettingsToStore(
  patch: Partial<SessionFeedbackLoopSettings>,
): Promise<void> {
  await saveWiseDefaultConfig({
    ...(patch.enabled !== undefined ? { sessionFeedbackLoopEnabled: patch.enabled } : {}),
    ...(patch.maxCycles !== undefined ? { sessionFeedbackLoopMaxCycles: patch.maxCycles } : {}),
    ...(patch.autoStart !== undefined ? { sessionFeedbackLoopAutoStart: patch.autoStart } : {}),
    ...(patch.earlyStopConvergence !== undefined
      ? { sessionFeedbackLoopEarlyStop: patch.earlyStopConvergence }
      : {}),
    ...(patch.autoSaveHabitsToComposer !== undefined
      ? { sessionFeedbackLoopSaveHabitsToComposer: patch.autoSaveHabitsToComposer }
      : {}),
    ...(patch.injectHabitsToSystemPrompt !== undefined
      ? { sessionFeedbackLoopInjectSystemPrompt: patch.injectHabitsToSystemPrompt }
      : {}),
    ...(patch.optimizeConfigArtifacts !== undefined
      ? { sessionFeedbackLoopOptimizeConfigArtifacts: patch.optimizeConfigArtifacts }
      : {}),
    ...(patch.globalRules !== undefined
      ? { sessionFeedbackLoopGlobalRules: normalizeFeedbackGlobalRules(patch.globalRules) }
      : {}),
    ...(patch.injectGlobalRules !== undefined
      ? { sessionFeedbackLoopInjectGlobalRules: patch.injectGlobalRules }
      : {}),
    ...(patch.autoApplyConfigPatches !== undefined
      ? { sessionFeedbackLoopAutoApplyConfigPatches: patch.autoApplyConfigPatches }
      : {}),
    ...(patch.autoRollbackOnRegression !== undefined
      ? { sessionFeedbackLoopAutoRollbackOnRegression: patch.autoRollbackOnRegression }
      : {}),
    ...(patch.autoVerifyAfterApply !== undefined
      ? { sessionFeedbackLoopAutoVerifyAfterApply: patch.autoVerifyAfterApply }
      : {}),
  });
}

/** @deprecated 使用 loadSessionFeedbackLoopSettingsFromStore */
export async function loadSessionFeedbackLoopEnabledFromStore(): Promise<boolean> {
  return (await loadSessionFeedbackLoopSettingsFromStore()).enabled;
}

/** @deprecated 使用 saveSessionFeedbackLoopSettingsToStore */
export async function saveSessionFeedbackLoopEnabledToStore(enabled: boolean): Promise<void> {
  await saveSessionFeedbackLoopSettingsToStore({ enabled });
}

let lastRegisteredAtMentionShortcutsJson = "";

export async function registerAtMentionGlobalShortcuts(
  bindings: Record<string, string>,
): Promise<void> {
  const serialized = JSON.stringify(bindings);
  if (serialized === lastRegisteredAtMentionShortcutsJson) return;
  lastRegisteredAtMentionShortcutsJson = serialized;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cmd_register_at_mention_shortcuts", { bindings });
}
