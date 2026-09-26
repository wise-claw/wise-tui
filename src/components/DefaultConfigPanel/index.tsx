import { Button, Checkbox, Input, Select, Switch, Typography } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import {
  encodeAtMentionDefaultSelectValue,
  decodeAtMentionDefaultSelectValue,
} from "../../constants/atMentionDefault";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES_OFFERED,
  type SessionExecutionEngine,
} from "../../constants/sessionExecutionEngine";
import {
  SESSION_DISPLAY_LANGUAGES,
  SESSION_DISPLAY_LANGUAGE_LABELS,
  type SessionDisplayLanguage,
} from "../../constants/sessionDisplayLanguage";
import { MONITOR_PANEL_VISIBLE_ROWS_OPTIONS } from "../../constants/monitorPanelLayout";
import { REQUIREMENTS_PANEL_VISIBLE_ROWS_OPTIONS } from "../../constants/requirementsPanelLayout";
import { WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS, formatWorkspaceListVisibleRowsLabel } from "../../constants/workspaceListLayout";
import { WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_OPTIONS } from "../../constants/workspaceSidebarLayout";
import { LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS } from "../../constants/leftSidebarHubQuickEntries";
import type { LeftSidebarHubQuickEntryId } from "../../constants/leftSidebarHubQuickEntries";
import {
  TERMINAL_THEME_MODES,
  TERMINAL_THEME_MODE_LABELS,
  type TerminalThemeMode,
} from "../../constants/terminalThemeMode";
import { useClaudeConnectionModeSetting } from "../ClaudeConfigDirPanel/useClaudeConnectionModeSetting";
import { DefaultConfigOptionPick } from "./DefaultConfigOptionPick";
import { DefaultConfigRow } from "./DefaultConfigRow";
import { DefaultConfigCheckboxGrid } from "./defaultConfigCheckboxGrid";
import { useLeftSidebarHubQuickEntriesSetting } from "./useLeftSidebarHubQuickEntriesSetting";
import { useMonitorPanelSetting } from "./useMonitorPanelSetting";
import { useLeftSidebarWorkspaceListSetting } from "./useLeftSidebarWorkspaceListSetting";
import { useLeftSidebarRequirementsPanelSetting } from "./useLeftSidebarRequirementsPanelSetting";
import { useWorkspaceSidebarRowPreviewLimitSetting } from "./useWorkspaceSidebarRowPreviewLimitSetting";
import { useExecutionEnvironmentDispatchHistoryDaysSetting } from "./useExecutionEnvironmentDispatchHistoryDaysSetting";
import { EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS } from "../../constants/executionEnvironmentDispatch";
import { useTopbarChromeDefaultSetting } from "./useTopbarChromeDefaultSetting";
import { useComposerFooterChromeDefaultSetting } from "./useComposerFooterChromeDefaultSetting";
import { useFeaturePanelChromeDefaultSetting } from "./useFeaturePanelChromeDefaultSetting";
import { useHudDetailsSetting } from "./useHudDetailsSetting";
import { useShowThinkingMessagesSetting } from "./useShowThinkingMessagesSetting";
import { useDefaultTerminalSetting } from "./useDefaultTerminalSetting";
import { useDefaultExecutionEngineSetting } from "./useDefaultExecutionEngineSetting";
import { useTerminalThemeModeSetting } from "./useTerminalThemeModeSetting";
import { claudeSettingsNeedsRawEditor } from "./claudeDefaultSettings";
import { useClaudeDefaultSettingsSetting } from "./useClaudeDefaultSettingsSetting";
import type { CodexPermissionPreset } from "./codexDefaultSettings";
import { ClaudeSettingsJsonEditor } from "../ClaudeSessions/ClaudeSettingsJsonEditor";
import { useCodexDefaultSettingsSetting } from "./useCodexDefaultSettingsSetting";
import { useOpencodeDefaultSettingsSetting } from "./useOpencodeDefaultSettingsSetting";
import { OPENCODE_PERMISSION_PLACEHOLDER } from "./opencodeDefaultSettings";
import { useAtMentionDefaultSetting } from "./useAtMentionDefaultSetting";
import { useAtMentionShortcuts } from "../../hooks/useAtMentionShortcuts";
import { KeyShortcutCapture } from "./KeyShortcutCapture";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import { useFileTreeOpenInNewPaneSetting } from "./useFileTreeOpenInNewPaneSetting";
import { useSessionAuxReuseInCenterTabsSetting } from "./useSessionAuxReuseInCenterTabsSetting";
import { useMarkdownDefaultOpenModeSetting } from "./useMarkdownDefaultOpenModeSetting";
import type { MarkdownDefaultOpenMode } from "../../services/wiseDefaultConfigStore";
import { useRepoPanelPlacementSetting } from "./useRepoPanelPlacementSetting";
import { useSessionFeedbackLoopSetting } from "./useSessionFeedbackLoopSetting";
import { useSessionDisplayLanguageSetting } from "./useSessionDisplayLanguageSetting";
import { useOpenInTerminalShortcutSetting } from "./useOpenInTerminalShortcutSetting";
import { useOpenInEditorShortcutSetting } from "./useOpenInEditorShortcutSetting";
import {
  removeFeedbackGlobalRule,
  setFeedbackGlobalRuleEnabled,
} from "../../services/sessionFeedbackGlobalRulesStore";
import { listEmployees } from "../../services/employees";
import type { EmployeeItem } from "../../types";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import "./index.css";

function DefaultConfigSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-default-config-section" aria-label={title}>
      <h3 className="app-default-config-section__title">{title}</h3>
      <div className="app-default-config-panel__settings">{children}</div>
    </section>
  );
}

/** 工作台配置 / 运行设置 / 默认配置：全局会话与布局默认值。
 *
 * 弹窗按使用场景分组：
 * - 新建会话 / 引擎 / 终端：开新会话时生效的默认
 * - 左栏 / Git 文件：屏幕上的栏位与显隐
 * - 输入框 / 界面 / 仓库操作快捷键：交互元素自身的默认
 * - 开发实验：反馈神经网
 */
export function DefaultConfigPanel() {
  const connection = useClaudeConnectionModeSetting();
  const defaultExecutionEngine = useDefaultExecutionEngineSetting();
  const claudeDefaultSettings = useClaudeDefaultSettingsSetting();
  const codexDefaultSettings = useCodexDefaultSettingsSetting();
  const opencodeDefaultSettings = useOpencodeDefaultSettingsSetting();
  const topbarChrome = useTopbarChromeDefaultSetting();
  const composerFooterChrome = useComposerFooterChromeDefaultSetting();
  const featurePanelChrome = useFeaturePanelChromeDefaultSetting();
  const hudDetails = useHudDetailsSetting();
  const thinkingMessages = useShowThinkingMessagesSetting();
  const hubQuickEntries = useLeftSidebarHubQuickEntriesSetting();
  const monitorPanel = useMonitorPanelSetting();
  const leftSidebarWorkspaceList = useLeftSidebarWorkspaceListSetting();
  const leftSidebarRequirementsPanel = useLeftSidebarRequirementsPanelSetting();
  const workspaceSidebarRowPreview = useWorkspaceSidebarRowPreviewLimitSetting();
  const repoPanelPlacement = useRepoPanelPlacementSetting();
  const execEnvDispatchHistory = useExecutionEnvironmentDispatchHistoryDaysSetting();
  const atMentionDefault = useAtMentionDefaultSetting();
  const atMentionShortcuts = useAtMentionShortcuts();
  const defaultTerminal = useDefaultTerminalSetting();
  const terminalThemeMode = useTerminalThemeModeSetting();
  const fileTreeOpenInNewPane = useFileTreeOpenInNewPaneSetting();
  const sessionAuxReuseInCenterTabs = useSessionAuxReuseInCenterTabsSetting();
  const markdownDefaultOpenMode = useMarkdownDefaultOpenModeSetting();
  const feedbackLoop = useSessionFeedbackLoopSetting();
  const sessionDisplayLanguage = useSessionDisplayLanguageSetting();
  const openInTerminalShortcut = useOpenInTerminalShortcutSetting();
  const openInEditorShortcut = useOpenInEditorShortcutSetting();
  const [terminalEmployees, setTerminalEmployees] = useState<EmployeeItem[]>([]);
  /** null = 随内容：含开关以外字段时展开 JSON。 */
  const [claudeJsonPref, setClaudeJsonPref] = useState<boolean | null>(null);
  /** 从预设进入沙箱/审批细调；与「当前不是四档预设」一起决定是否展开。 */
  const [codexRawPref, setCodexRawPref] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listEmployees().then((rows) => {
      if (cancelled) return;
      setTerminalEmployees(
        rows.filter((item) => item.enabled && item.name.trim() && !isOmcMonitorEmployeeRecord(item)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const atMentionDefaultSelectOptions = useMemo(() => {
    const engines = SESSION_EXECUTION_ENGINES_OFFERED.map((engine) => ({
      value: encodeAtMentionDefaultSelectValue({ kind: "execution_engine", engine }),
      label: `执行环境 · ${SESSION_EXECUTION_ENGINE_LABELS[engine].title}`,
    }));
    const terminals = terminalEmployees.map((employee) => ({
      value: encodeAtMentionDefaultSelectValue({ kind: "terminal", employeeName: employee.name }),
      label: `席位 · ${employee.name}`,
    }));
    return [...engines, ...terminals];
  }, [terminalEmployees]);

  const atMentionDefaultSelectValue = encodeAtMentionDefaultSelectValue(atMentionDefault.target);

  const atMentionShortcutRows = useMemo(() => {
    const rows: Array<{ target: AtMentionDefaultTarget; label: string; group: string }> = [];
    for (const engine of SESSION_EXECUTION_ENGINES_OFFERED) {
      rows.push({
        target: { kind: "execution_engine", engine },
        label: SESSION_EXECUTION_ENGINE_LABELS[engine].title,
        group: "执行环境",
      });
    }
    for (const employee of terminalEmployees) {
      rows.push({
        target: { kind: "terminal", employeeName: employee.name },
        label: employee.name,
        group: "席位",
      });
    }
    return rows;
  }, [terminalEmployees]);

  const topbarToolOptions = useMemo(
    () => [
      { label: "仓库名", value: "repo-name", checked: topbarChrome.showTopbarRepositoryName },
      { label: "远程入口", value: "remote-entry", checked: topbarChrome.showRemoteEntryTopbar },
      { label: "终端", value: "open-in-terminal", checked: topbarChrome.showTopbarOpenInTerminal },
      { label: "打开目录", value: "open-directory", checked: topbarChrome.showTopbarOpenDirectory },
      { label: "FCC", value: "fcc", checked: topbarChrome.showFccTopbar },
      { label: "OpenCode", value: "opencode", checked: topbarChrome.showOpencodeProxyTopbar },
      { label: "FCC 流量", value: "fcc-traffic", checked: topbarChrome.showFccTrafficTopbar },
      { label: "LLM 代理", value: "llm-proxy", checked: topbarChrome.showLlmProxyTopbar },
      { label: "全链路", value: "data-link", checked: topbarChrome.showSessionDataLinkTopbar },
      { label: "神经网", value: "feedback-loop", checked: topbarChrome.showSessionFeedbackLoopTopbar },
    ],
    [topbarChrome],
  );

  const composerFooterOptions = useMemo(
    () => [
      {
        label: "附件",
        value: "attach",
        checked: composerFooterChrome.showComposerFooterAttachButton,
      },
      {
        label: "截屏",
        value: "screenshot",
        checked: composerFooterChrome.showComposerFooterScreenshotButton,
      },
      {
        label: "语音",
        value: "voice",
        checked: composerFooterChrome.showComposerFooterVoiceButton,
      },
      {
        label: "上下文",
        value: "context",
        checked: composerFooterChrome.showComposerFooterContextRing,
      },
      {
        label: "常用语",
        value: "phrases",
        checked: composerFooterChrome.showComposerFooterCommonPhrases,
      },
      {
        label: "执行环境",
        value: "runtime",
        checked: composerFooterChrome.showComposerFooterRuntimeSettings,
      },
      {
        label: "模型",
        value: "model",
        checked: composerFooterChrome.showComposerFooterModelPicker,
      },
    ],
    [composerFooterChrome],
  );

  const featurePanelOptions = useMemo(
    () => [
      {
        label: "历史会话",
        value: "history-sessions",
        checked: featurePanelChrome.showFeaturePanelHistorySessions,
      },
      {
        label: "历史消息",
        value: "history-messages",
        checked: featurePanelChrome.showFeaturePanelHistoryMessages,
      },
      {
        label: "定时任务",
        value: "scheduled-tasks",
        checked: featurePanelChrome.showFeaturePanelScheduledTasks,
      },
    ],
    [featurePanelChrome],
  );

  const feedbackBehaviorOptions = useMemo(
    () => [
      {
        label: "警告时自动启动",
        value: "auto-start",
        checked: feedbackLoop.autoStart,
      },
      {
        label: "收敛早停",
        value: "early-stop",
        checked: feedbackLoop.earlyStopConvergence,
      },
      {
        label: "写入常用语",
        value: "save-habits",
        checked: feedbackLoop.autoSaveHabitsToComposer,
      },
      {
        label: "注入 System Prompt",
        value: "inject-prompt",
        checked: feedbackLoop.injectHabitsToSystemPrompt,
      },
      {
        label: "优化持久配置",
        value: "optimize-artifacts",
        checked: feedbackLoop.optimizeConfigArtifacts,
      },
      {
        label: "自动写入补丁",
        value: "auto-apply",
        checked: feedbackLoop.autoApplyConfigPatches,
      },
      {
        label: "自动验证轮次",
        value: "auto-verify",
        checked: feedbackLoop.autoVerifyAfterApply,
      },
      {
        label: "评分回归回滚",
        value: "auto-rollback",
        checked: feedbackLoop.autoRollbackOnRegression,
      },
      {
        label: "注入全局规则",
        value: "inject-global",
        checked: feedbackLoop.injectGlobalRules,
      },
    ],
    [feedbackLoop],
  );

  const handleTopbarToolToggle = (value: string, checked: boolean) => {
    switch (value) {
      case "repo-name":
        void topbarChrome.saveTopbarRepositoryName(checked);
        break;
      case "remote-entry":
        void topbarChrome.saveRemoteEntry(checked);
        break;
      case "open-in-terminal":
        void topbarChrome.saveTopbarOpenInTerminal(checked);
        break;
      case "open-directory":
        void topbarChrome.saveTopbarOpenDirectory(checked);
        break;
      case "fcc":
        void topbarChrome.saveFcc(checked);
        break;
      case "opencode":
        void topbarChrome.saveOpencodeProxy(checked);
        break;
      case "fcc-traffic":
        void topbarChrome.saveFccTraffic(checked);
        break;
      case "llm-proxy":
        void topbarChrome.saveLlmProxy(checked);
        break;
      case "data-link":
        void topbarChrome.saveSessionDataLink(checked);
        break;
      case "feedback-loop":
        void topbarChrome.saveSessionFeedbackLoop(checked);
        break;
      default:
        break;
    }
  };

  const handleComposerFooterToggle = (value: string, checked: boolean) => {
    switch (value) {
      case "attach":
        void composerFooterChrome.saveAttachButton(checked);
        break;
      case "screenshot":
        void composerFooterChrome.saveScreenshotButton(checked);
        break;
      case "voice":
        void composerFooterChrome.saveVoiceButton(checked);
        break;
      case "context":
        void composerFooterChrome.saveContextRing(checked);
        break;
      case "phrases":
        void composerFooterChrome.saveCommonPhrases(checked);
        break;
      case "runtime":
        void composerFooterChrome.saveRuntimeSettings(checked);
        break;
      case "model":
        void composerFooterChrome.saveModelPicker(checked);
        break;
      default:
        break;
    }
  };

  const handleFeaturePanelToggle = (value: string, checked: boolean) => {
    switch (value) {
      case "history-sessions":
        void featurePanelChrome.saveHistorySessions(checked);
        break;
      case "history-messages":
        void featurePanelChrome.saveHistoryMessages(checked);
        break;
      case "scheduled-tasks":
        void featurePanelChrome.saveScheduledTasks(checked);
        break;
      default:
        break;
    }
  };

  const handleFeedbackBehaviorToggle = (value: string, checked: boolean) => {
    const disabled =
      feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled;
    if (disabled) return;

    switch (value) {
      case "auto-start":
        void feedbackLoop.saveAutoStart(checked);
        break;
      case "early-stop":
        void feedbackLoop.saveEarlyStopConvergence(checked);
        break;
      case "save-habits":
        void feedbackLoop.saveAutoSaveHabitsToComposer(checked);
        break;
      case "inject-prompt":
        void feedbackLoop.saveInjectHabitsToSystemPrompt(checked);
        break;
      case "optimize-artifacts":
        void feedbackLoop.saveOptimizeConfigArtifacts(checked);
        break;
      case "auto-apply":
        if (!feedbackLoop.optimizeConfigArtifacts && checked) return;
        void feedbackLoop.saveAutoApplyConfigPatches(checked);
        break;
      case "auto-verify":
        if (!feedbackLoop.optimizeConfigArtifacts && checked) return;
        void feedbackLoop.saveAutoVerifyAfterApply(checked);
        break;
      case "auto-rollback":
        if (!feedbackLoop.optimizeConfigArtifacts && checked) return;
        void feedbackLoop.saveAutoRollbackOnRegression(checked);
        break;
      case "inject-global":
        if (feedbackLoop.globalRules.length === 0 && checked) return;
        void feedbackLoop.saveInjectGlobalRules(checked);
        break;
      default:
        break;
    }
  };

  const showClaudeJson = claudeJsonPref ?? claudeSettingsNeedsRawEditor(claudeDefaultSettings.value);
  const codexUnmatched =
    codexDefaultSettings.permissionPreset === "custom" &&
    (codexDefaultSettings.sandboxMode != null || codexDefaultSettings.approvalPolicy != null);
  const showCodexRaw = codexRawPref || codexUnmatched;

  const sections = [
    {
      key: "session",
      title: "新建会话",
      content: (
        <>
          <DefaultConfigRow
            title="会话处理方式"
            detail="新建标签默认；已单独设置过的标签不变"
            control={
              <DefaultConfigOptionPick<ClaudeSessionConnectionKind>
                aria-label="会话处理方式"
                disabled={connection.loading || connection.saving}
                value={connection.kind}
                options={[
                  { label: "逐轮", value: "oneshot" },
                  { label: "长驻", value: "streaming" },
                ]}
                onChange={(value) => {
                  void connection.save(value);
                }}
              />
            }
          />
          <DefaultConfigRow
            title="执行环境"
            detail="新建会话默认；仓库 / 席位单独设置过的执行引擎不变"
            control={
              <Select
                size="small"
                showSearch
                optionFilterProp="label"
                aria-label="默认执行环境"
                disabled={defaultExecutionEngine.loading || defaultExecutionEngine.saving}
                value={defaultExecutionEngine.engine}
                style={{ minWidth: 140 }}
                options={SESSION_EXECUTION_ENGINES_OFFERED.map((engine) => ({
                  label: SESSION_EXECUTION_ENGINE_LABELS[engine].title,
                  value: engine,
                }))}
                onChange={(value) => {
                  void defaultExecutionEngine.save(value as SessionExecutionEngine);
                }}
              />
            }
          />
          <DefaultConfigRow
            title="回复语言"
            hint="助手输出"
            detail="会话助手默认使用的回复语言；「默认」跟随各引擎 / 助手的提示词。代码、命令、路径与引用原文不受影响。"
            control={
              <Select
                size="small"
                aria-label="会话回复语言"
                disabled={sessionDisplayLanguage.loading || sessionDisplayLanguage.saving}
                value={sessionDisplayLanguage.language}
                style={{ minWidth: 140 }}
                options={SESSION_DISPLAY_LANGUAGES.map((language) => ({
                  value: language,
                  label: SESSION_DISPLAY_LANGUAGE_LABELS[language],
                }))}
                onChange={(value) => {
                  void sessionDisplayLanguage.save(value as SessionDisplayLanguage);
                }}
              />
            }
          />
        </>
      ),
    },
    {
      key: "engines",
      title: "引擎",
      content: (
        <>
          <DefaultConfigRow
            title="Claude"
            detail="新会话的 Ultracode、沙箱与权限，和输入框权限徽标是同一份配置。JSON 只在需要改其它字段时展开。"
            layout={showClaudeJson ? "stack" : "inline"}
            control={
              <div
                className={
                  showClaudeJson
                    ? "app-default-config-claude-settings app-default-config-claude-settings--open"
                    : "app-default-config-claude-settings"
                }
              >
                <div className="app-default-config-engine-controls">
                  <span className="app-default-config-claude-settings__toggle">
                    ultracode
                    <Switch
                      size="small"
                      checked={claudeDefaultSettings.ultracodeEnabled}
                      disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                      onChange={(checked) => {
                        void claudeDefaultSettings.saveUltracode(checked);
                      }}
                    />
                  </span>
                  <span className="app-default-config-claude-settings__toggle">
                    取消沙箱
                    <Switch
                      size="small"
                      checked={claudeDefaultSettings.sandboxDisabled}
                      disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                      onChange={(checked) => {
                        void claudeDefaultSettings.saveSandboxDisabled(checked);
                      }}
                    />
                  </span>
                  <Select
                    size="small"
                    aria-label="Claude permission-mode"
                    disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                    value={claudeDefaultSettings.effectivePermissionMode}
                    onChange={(v: string) => {
                      void claudeDefaultSettings.savePermissionMode(v);
                    }}
                    style={{ minWidth: 108 }}
                    options={[
                      { label: "请求批准", value: "default" },
                      { label: "接受编辑", value: "acceptEdits" },
                      { label: "仅计划", value: "plan" },
                      { label: "完全访问", value: "bypassPermissions" },
                    ]}
                  />
                  <Button
                    type="link"
                    size="small"
                    className="app-default-config-engine-json-toggle"
                    aria-expanded={showClaudeJson}
                    onClick={() => {
                      setClaudeJsonPref(!showClaudeJson);
                    }}
                  >
                    {showClaudeJson ? "收起" : "JSON"}
                  </Button>
                </div>
                {showClaudeJson ? (
                  <>
                    <ClaudeSettingsJsonEditor
                      ariaLabel="Claude 启动 --settings JSON"
                      value={claudeDefaultSettings.draft}
                      height={96}
                      readOnly={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                      onChange={claudeDefaultSettings.setDraft}
                      onBlur={() => {
                        if (claudeDefaultSettings.loading || claudeDefaultSettings.saving) return;
                        void claudeDefaultSettings.commit();
                      }}
                    />
                    <div className="app-default-config-engine-controls">
                      <Button
                        size="small"
                        disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                        onClick={() => {
                          void claudeDefaultSettings.format();
                        }}
                      >
                        格式化
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            }
          />
          <DefaultConfigRow
            title="Codex"
            detail="与输入框权限徽标同一份配置。自定义使用 Codex 配置文件；分别设置可指定沙箱与审批。"
            layout={showCodexRaw ? "stack" : "inline"}
            control={
              <div
                className={
                  showCodexRaw
                    ? "app-default-config-claude-settings app-default-config-claude-settings--open"
                    : "app-default-config-claude-settings"
                }
              >
                <div className="app-default-config-engine-controls">
                  <Select
                    size="small"
                    aria-label="Codex 权限预设"
                    disabled={codexDefaultSettings.loading || codexDefaultSettings.saving}
                    value={showCodexRaw ? "raw" : codexDefaultSettings.permissionPreset}
                    onChange={(value: CodexPermissionPreset | "raw") => {
                      if (value === "raw") {
                        setCodexRawPref(true);
                        return;
                      }
                      setCodexRawPref(false);
                      void codexDefaultSettings.savePermissionPreset(value);
                    }}
                    style={{ minWidth: 108 }}
                    options={[
                      { label: "请求批准", value: "ask" },
                      { label: "替我审批", value: "auto" },
                      { label: "完全访问", value: "full" },
                      { label: "自定义", value: "custom" },
                      { label: "分别设置", value: "raw" },
                    ]}
                  />
                </div>
                {showCodexRaw ? (
                  <div className="app-default-config-engine-controls">
                    <span className="app-default-config-cli-settings__toggle">
                      沙箱
                      <Select
                        size="small"
                        aria-label="Codex sandbox_mode"
                        disabled={codexDefaultSettings.loading || codexDefaultSettings.saving}
                        value={codexDefaultSettings.sandboxMode ?? ""}
                        onChange={(v: string) => {
                          void codexDefaultSettings.saveSandboxMode(v || null);
                        }}
                        style={{ minWidth: 88 }}
                        options={[
                          { label: "默认", value: "" },
                          { label: "只读", value: "read-only" },
                          { label: "可写", value: "workspace-write" },
                          { label: "完全", value: "danger-full-access" },
                        ]}
                      />
                    </span>
                    <span className="app-default-config-cli-settings__toggle">
                      审批
                      <Select
                        size="small"
                        aria-label="Codex approval_policy"
                        disabled={codexDefaultSettings.loading || codexDefaultSettings.saving}
                        value={codexDefaultSettings.approvalPolicy ?? ""}
                        onChange={(v: string) => {
                          void codexDefaultSettings.saveApprovalPolicy(v || null);
                        }}
                        style={{ minWidth: 108 }}
                        options={[
                          { label: "默认", value: "" },
                          { label: "始终询问", value: "untrusted" },
                          { label: "风险时询问", value: "on-request" },
                          { label: "不询问", value: "never" },
                        ]}
                      />
                    </span>
                  </div>
                ) : null}
              </div>
            }
          />
          <DefaultConfigRow
            title="OpenCode"
            detail="自动批准会跳过权限询问；自定义规则写入 OPENCODE_PERMISSION。"
            layout={opencodeDefaultSettings.mode === "custom" ? "stack" : "inline"}
            control={
              <div
                className={
                  opencodeDefaultSettings.mode === "custom"
                    ? "app-default-config-claude-settings app-default-config-claude-settings--open"
                    : "app-default-config-claude-settings"
                }
              >
                <div className="app-default-config-engine-controls">
                  <DefaultConfigOptionPick<"auto" | "custom">
                    aria-label="OpenCode 权限模式"
                    disabled={opencodeDefaultSettings.loading || opencodeDefaultSettings.saving}
                    value={opencodeDefaultSettings.mode}
                    options={[
                      { label: "自动批准", value: "auto" },
                      { label: "自定义", value: "custom" },
                    ]}
                    onChange={(value) => {
                      void opencodeDefaultSettings.saveMode(value);
                    }}
                  />
                  {opencodeDefaultSettings.mode === "custom" ? (
                    <Button
                      size="small"
                      disabled={opencodeDefaultSettings.loading || opencodeDefaultSettings.saving}
                      onClick={() => {
                        void opencodeDefaultSettings.format();
                      }}
                    >
                      格式化
                    </Button>
                  ) : null}
                </div>
                {opencodeDefaultSettings.mode === "custom" ? (
                  <Input.TextArea
                    aria-label="OpenCode permission JSON"
                    value={opencodeDefaultSettings.permissionDraft}
                    placeholder={OPENCODE_PERMISSION_PLACEHOLDER}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    disabled={opencodeDefaultSettings.loading || opencodeDefaultSettings.saving}
                    onChange={(e) => opencodeDefaultSettings.setPermissionDraft(e.target.value)}
                    onBlur={() => {
                      void opencodeDefaultSettings.commit();
                    }}
                  />
                ) : null}
              </div>
            }
          />
        </>
      ),
    },
    {
      key: "terminal",
      title: "终端",
      content: (
        <>
          {defaultTerminal.isMac ? (
            <DefaultConfigRow
              title="外部终端"
              detail="在外部打开仓库目录时使用的 macOS 终端"
              control={
                defaultTerminal.detected.length > 0 ? (
                  <div className="app-default-config-terminal-picker">
                    <Select
                      size="small"
                      className="app-default-config-terminal-select"
                      aria-label="默认终端"
                      placeholder="选择终端"
                      loading={defaultTerminal.loading}
                      disabled={defaultTerminal.loading || defaultTerminal.saving}
                      value={defaultTerminal.selectedId ?? undefined}
                      options={defaultTerminal.options}
                      onChange={(value) => {
                        void defaultTerminal.save(String(value));
                      }}
                    />
                    <Button
                      type="link"
                      size="small"
                      className="app-default-config-terminal-rescan"
                      disabled={defaultTerminal.loading || defaultTerminal.saving}
                      onClick={() => {
                        void defaultTerminal.refresh();
                      }}
                    >
                      重新检测
                    </Button>
                  </div>
                ) : (
                  <div className="app-default-config-terminal-picker">
                    <Typography.Text type="secondary" className="app-default-config-terminal-empty">
                      {defaultTerminal.loading ? "正在检测终端…" : "未检测到可用的终端应用"}
                    </Typography.Text>
                    {!defaultTerminal.loading ? (
                      <Button
                        type="link"
                        size="small"
                        className="app-default-config-terminal-rescan"
                        onClick={() => {
                          void defaultTerminal.refresh();
                        }}
                      >
                        重新检测
                      </Button>
                    ) : null}
                  </div>
                )
              }
            />
          ) : null}
          <DefaultConfigRow
            title="内置主题"
            detail="内置终端配色。跟随应用时与顶栏外观开关同步"
            control={
              <DefaultConfigOptionPick<TerminalThemeMode>
                aria-label="内置终端主题"
                disabled={terminalThemeMode.loading || terminalThemeMode.saving}
                value={terminalThemeMode.mode}
                options={TERMINAL_THEME_MODES.map((value) => ({
                  label: TERMINAL_THEME_MODE_LABELS[value],
                  value,
                }))}
                onChange={(value) => {
                  void terminalThemeMode.save(value);
                }}
              />
            }
          />
        </>
      ),
    },
    // 左栏：工作区、需求、运行面板、预览与快捷入口。
    {
      key: "leftSidebar",
      title: "左栏",
      content: (
        <>
          <DefaultConfigRow
            title="工作区树"
            detail="展开后显示会话与运行项；栏位会同步左栏分区顺序，也可直接拖拽分区标题重排"
            control={
              <div className="app-default-config-row__control--monitor">
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">显示</span>
                  <DefaultConfigOptionPick<"hidden" | "visible">
                    aria-label="左栏工作区默认显示"
                    disabled={leftSidebarWorkspaceList.loading || leftSidebarWorkspaceList.saving}
                    value={leftSidebarWorkspaceList.visible ? "visible" : "hidden"}
                    options={[
                      { label: "显示", value: "visible" },
                      { label: "隐藏", value: "hidden" },
                    ]}
                    onChange={(value) => {
                      void leftSidebarWorkspaceList.saveVisible(value === "visible");
                    }}
                  />
                </div>
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">栏位</span>
                  <DefaultConfigOptionPick<"top" | "bottom">
                    aria-label="左栏工作区栏位"
                    disabled={
                      leftSidebarWorkspaceList.loading ||
                      leftSidebarWorkspaceList.saving ||
                      !leftSidebarWorkspaceList.visible
                    }
                    value={leftSidebarWorkspaceList.placement}
                    options={[
                      { label: "顶", value: "top" },
                      { label: "底", value: "bottom" },
                    ]}
                    onChange={(value) => {
                      void leftSidebarWorkspaceList.savePlacement(value);
                    }}
                  />
                </div>
                <div className="app-default-config-monitor-panel__field app-default-config-monitor-panel__field--rows">
                  <span className="app-default-config-monitor-panel__field-label">行数</span>
                  <Select
                    size="small"
                    className="app-default-config-monitor-panel__rows-select"
                    aria-label="工作区树可见行数"
                    disabled={
                      leftSidebarWorkspaceList.loading ||
                      leftSidebarWorkspaceList.saving ||
                      !leftSidebarWorkspaceList.visible
                    }
                    value={leftSidebarWorkspaceList.visibleRows}
                    options={WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS.map((rows) => ({
                      value: rows,
                      label: formatWorkspaceListVisibleRowsLabel(rows),
                    }))}
                    onChange={(value) => {
                      void leftSidebarWorkspaceList.saveVisibleRows(value);
                    }}
                  />
                </div>
              </div>
            }
          />

          <DefaultConfigRow
            title="需求列表"
            detail="左栏需求模块；超出行数后滚动。新增需求须指定归属仓库"
            control={
              <div className="app-default-config-row__control--monitor">
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">显示</span>
                  <DefaultConfigOptionPick<"hidden" | "visible">
                    aria-label="左栏需求列表默认显示"
                    disabled={leftSidebarRequirementsPanel.loading || leftSidebarRequirementsPanel.saving}
                    value={leftSidebarRequirementsPanel.visible ? "visible" : "hidden"}
                    options={[
                      { label: "显示", value: "visible" },
                      { label: "隐藏", value: "hidden" },
                    ]}
                    onChange={(value) => {
                      void leftSidebarRequirementsPanel.saveVisible(value === "visible");
                    }}
                  />
                </div>
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">行数</span>
                  <Select
                    size="small"
                    className="app-default-config-monitor-panel__rows-select"
                    aria-label="需求列表可见行数"
                    disabled={
                      leftSidebarRequirementsPanel.loading ||
                      leftSidebarRequirementsPanel.saving ||
                      !leftSidebarRequirementsPanel.visible
                    }
                    value={leftSidebarRequirementsPanel.visibleRows}
                    options={REQUIREMENTS_PANEL_VISIBLE_ROWS_OPTIONS.map((rows) => ({
                      value: rows,
                      label: `${rows}`,
                    }))}
                    onChange={(value) => {
                      void leftSidebarRequirementsPanel.saveVisibleRows(value);
                    }}
                  />
                </div>
              </div>
            }
          />

          <DefaultConfigRow
            title="会话预览"
            detail="工作区展开后默认展示的会话与运行行数；超出可点 More"
            control={
              <Select
                size="small"
                className="app-default-config-session-preview-select"
                aria-label="工作区会话默认展示数量"
                disabled={workspaceSidebarRowPreview.loading || workspaceSidebarRowPreview.saving}
                value={workspaceSidebarRowPreview.previewLimit}
                options={WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_OPTIONS.map((rows) => ({
                  value: rows,
                  label: `${rows} 条`,
                }))}
                onChange={(value) => {
                  void workspaceSidebarRowPreview.savePreviewLimit(value);
                }}
              />
            }
          />

          <DefaultConfigRow
            title="派发历史"
            detail="左栏派发任务默认查询天数；列表头可临时切换"
            control={
              <Select
                size="small"
                aria-label="派发任务默认历史天数"
                disabled={execEnvDispatchHistory.loading || execEnvDispatchHistory.saving}
                value={execEnvDispatchHistory.days}
                options={EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.map((day) => ({
                  value: day,
                  label: `${day} 天`,
                }))}
                onChange={(value) => {
                  void execEnvDispatchHistory.save(value);
                }}
              />
            }
          />

          <DefaultConfigRow
            title="运行面板"
            detail="席位、派发与工作流；关闭后不再显示"
            control={
              <div className="app-default-config-row__control--monitor">
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">显示</span>
                  <DefaultConfigOptionPick<"visible" | "hidden">
                    aria-label="运行面板默认显示"
                    disabled={monitorPanel.loading || monitorPanel.saving}
                    value={monitorPanel.visible ? "visible" : "hidden"}
                    options={[
                      { label: "显示", value: "visible" },
                      { label: "隐藏", value: "hidden" },
                    ]}
                    onChange={(value) => {
                      void monitorPanel.saveVisible(value === "visible");
                    }}
                  />
                </div>
                <div className="app-default-config-monitor-panel__field">
                  <span className="app-default-config-monitor-panel__field-label">栏位</span>
                  <DefaultConfigOptionPick<"left" | "right">
                    aria-label="运行面板默认栏位"
                    disabled={monitorPanel.loading || monitorPanel.saving || !monitorPanel.visible}
                    value={monitorPanel.placement}
                    options={[
                      { label: "左", value: "left" },
                      { label: "右", value: "right" },
                    ]}
                    onChange={(value) => {
                      void monitorPanel.savePlacement(value);
                    }}
                  />
                </div>
                <div className="app-default-config-monitor-panel__field app-default-config-monitor-panel__field--rows">
                  <span className="app-default-config-monitor-panel__field-label">行数</span>
                  <Select
                    size="small"
                    className="app-default-config-monitor-panel__rows-select"
                    aria-label="运行面板可见行数"
                    disabled={monitorPanel.loading || monitorPanel.saving || !monitorPanel.visible}
                    value={monitorPanel.visibleRows}
                    options={MONITOR_PANEL_VISIBLE_ROWS_OPTIONS.map((rows) => ({
                      value: rows,
                      label: `${rows}`,
                    }))}
                    onChange={(value) => {
                      void monitorPanel.saveVisibleRows(value);
                    }}
                  />
                </div>
              </div>
            }
          />

          <DefaultConfigRow
            title="快捷入口"
            hint="左栏顶部图标"
            detail="显示在左栏顶部；入口分别进入 Cockpit / 工作台配置"
            layout="stack"
            control={
              <Checkbox.Group
                className="app-default-config-hub-quick-checkboxes"
                disabled={hubQuickEntries.loading || hubQuickEntries.saving}
                value={hubQuickEntries.selected}
                options={hubQuickEntries.allEntryIds.map((id) => ({
                  label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
                  value: id,
                }))}
                onChange={(values) => {
                  void hubQuickEntries.save(values as LeftSidebarHubQuickEntryId[]);
                }}
              />
            }
          />
        </>
      ),
    },
    // Git / 文件树。
    {
      key: "gitFiles",
      title: "Git / 文件树",
      content: (
        <>
          <DefaultConfigRow
            title="默认显示"
            hint="Git / 文件"
            detail="Git 与文件树是否在左栏显示；同时显示时 Tab 切换"
            control={
              <div className="app-default-config-row__control--monitor">
                <DefaultConfigOptionPick<"visible" | "hidden">
                  aria-label="Git 默认显示"
                  disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
                  value={repoPanelPlacement.gitPanelPlacement}
                  options={[
                    { label: "Git·显", value: "visible" },
                    { label: "Git·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    void repoPanelPlacement.saveGitPlacement(value);
                  }}
                />
                <DefaultConfigOptionPick<"visible" | "hidden">
                  aria-label="文件树默认显示"
                  disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
                  value={repoPanelPlacement.filesPanelPlacement}
                  options={[
                    { label: "文件·显", value: "visible" },
                    { label: "文件·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    void repoPanelPlacement.saveFilesPlacement(value);
                  }}
                />
              </div>
            }
          />
          <DefaultConfigRow
            title="同栏分栏"
            hint="上下分栏"
            detail="同一栏时上下分栏展示（关闭时 Tab 切换）"
            control={
              <Switch
                aria-label="Git / 文件树分栏展示"
                disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
                checked={repoPanelPlacement.repoPanelSplitMode}
                onChange={(checked) => {
                  void repoPanelPlacement.saveSplitMode(checked);
                }}
              />
            }
          />
          <DefaultConfigRow
            title="文件打开"
            hint="侧栏点击"
            detail="侧栏文件在当前会话打开或新开一屏"
            control={
              <DefaultConfigOptionPick<"current" | "new-pane">
                aria-label="文件树打开方式"
                disabled={fileTreeOpenInNewPane.loading || fileTreeOpenInNewPane.saving}
                value={fileTreeOpenInNewPane.openInNewPane ? "new-pane" : "current"}
                options={[
                  { label: "当前", value: "current" },
                  { label: "新屏", value: "new-pane" },
                ]}
                onChange={(value) => {
                  void fileTreeOpenInNewPane.save(value === "new-pane");
                }}
              />
            }
          />
          <DefaultConfigRow
            title="会话右栏"
            hint="消息区复用"
            detail="将文件 / 需求 / 终端等右栏内容复用到会话消息区，顶部 Tab 切换"
            control={
              <DefaultConfigOptionPick<"rail" | "tabs">
                aria-label="会话右栏展示方式"
                disabled={sessionAuxReuseInCenterTabs.loading || sessionAuxReuseInCenterTabs.saving}
                value={sessionAuxReuseInCenterTabs.enabled ? "tabs" : "rail"}
                options={[
                  { label: "并排", value: "rail" },
                  { label: "顶部 Tab", value: "tabs" },
                ]}
                onChange={(value) => {
                  void sessionAuxReuseInCenterTabs.save(value === "tabs");
                }}
              />
            }
          />
          <DefaultConfigRow
            title="Markdown 打开"
            hint="编辑 / 预览"
            detail="新打开的 .md / .mdx 默认进入编辑或预览；已打开过的标签保持当前选择"
            control={
              <DefaultConfigOptionPick<MarkdownDefaultOpenMode>
                aria-label="Markdown 默认打开模式"
                disabled={markdownDefaultOpenMode.loading || markdownDefaultOpenMode.saving}
                value={markdownDefaultOpenMode.mode}
                options={[
                  { label: "编辑", value: "edit" },
                  { label: "预览", value: "preview" },
                ]}
                onChange={(value) => {
                  void markdownDefaultOpenMode.save(value);
                }}
              />
            }
          />
        </>
      ),
    },
    // 输入框：@ 提及 + 底栏按钮
    {
      key: "composer",
      title: "输入框",
      content: (
        <>
          <DefaultConfigRow
            title="@ 默认选中"
            hint="无筛选时高亮"
            control={
              <Select
                size="small"
                showSearch
                optionFilterProp="label"
                aria-label="@ 默认选中"
                disabled={atMentionDefault.loading || atMentionDefault.saving}
                value={atMentionDefaultSelectValue}
                options={atMentionDefaultSelectOptions}
                onChange={(value) => {
                  const decoded = decodeAtMentionDefaultSelectValue(String(value));
                  if (decoded) void atMentionDefault.save(decoded);
                }}
              />
            }
          />

          <DefaultConfigRow
            title="@ 快捷键"
            hint="聚焦输入框时"
            detail="聚焦输入框时按键插入 @ 提及（Esc 取消录制）"
            layout="stack"
            control={
              <ul className="app-default-config-at-mention-shortcuts">
                {atMentionShortcutRows.map((row) => (
                  <li
                    key={encodeAtMentionDefaultSelectValue(row.target)}
                    className="app-default-config-at-mention-shortcuts__row"
                  >
                    <span className="app-default-config-at-mention-shortcuts__label">
                      <span className="app-default-config-at-mention-shortcuts__group">{row.group}</span>
                      {row.label}
                    </span>
                    <KeyShortcutCapture
                      value={atMentionShortcuts.chordForTarget(row.target)}
                      disabled={atMentionShortcuts.loading || atMentionShortcuts.saving}
                      onChange={(chord) => {
                        void atMentionShortcuts.saveForTarget(row.target, chord);
                      }}
                    />
                  </li>
                ))}
              </ul>
            }
          />

          <DefaultConfigRow
            title="底栏按钮"
            hint="主会话输入框"
            detail="附件 ⌘I、截屏 F3 等快捷键在隐藏按钮后仍可用"
            layout="stack"
            control={
              <DefaultConfigCheckboxGrid
                ariaLabel="输入框底栏按钮显示"
                disabled={composerFooterChrome.loading || composerFooterChrome.saving}
                options={composerFooterOptions}
                onToggle={handleComposerFooterToggle}
              />
            }
          />

          <DefaultConfigRow
            title="触发器显示"
            hint="执行环境 / 模型"
            detail="主会话底栏「执行环境」与「模型切换」触发器：仅图标或完整（图标+文字）；紧凑模式 / 多屏始终仅图标"
            control={
              <DefaultConfigOptionPick<"full" | "icon">
                aria-label="底栏触发器显示模式"
                disabled={composerFooterChrome.loading || composerFooterChrome.saving}
                value={composerFooterChrome.composerFooterTriggerDisplayMode}
                options={[
                  { label: "完整", value: "full" },
                  { label: "图标", value: "icon" },
                ]}
                onChange={(value) => {
                  void composerFooterChrome.saveTriggerDisplayMode(value);
                }}
              />
            }
          />
        </>
      ),
    },
    {
      key: "chrome",
      title: "界面",
      content: (
        <>
          <DefaultConfigRow
            title="顶栏"
            detail="主会话顶栏图标与按钮；隐藏后部分仍可从「更多」打开"
            layout="stack"
            control={
              <DefaultConfigCheckboxGrid
                ariaLabel="顶栏图标与按钮显示"
                disabled={topbarChrome.loading || topbarChrome.saving}
                options={topbarToolOptions}
                onToggle={handleTopbarToolToggle}
              />
            }
          />
          <DefaultConfigRow
            title="功能按钮"
            detail="主会话顶栏下方的会话功能面板按钮"
            layout="stack"
            control={
              <DefaultConfigCheckboxGrid
                ariaLabel="会话功能面板按钮显示"
                disabled={featurePanelChrome.loading || featurePanelChrome.saving}
                options={featurePanelOptions}
                onToggle={handleFeaturePanelToggle}
              />
            }
          />
          <DefaultConfigRow
            title="HUD 详情"
            detail="进入 HUD 后在输入条上方默认显示完整会话详情；可拖动顶部调整高度"
            control={
              <Switch
                size="small"
                checked={hudDetails.enabled}
                loading={hudDetails.saving}
                disabled={hudDetails.loading || hudDetails.saving}
                onChange={(checked) => {
                  void hudDetails.save(checked);
                }}
              />
            }
          />
          <DefaultConfigRow
            title="思考消息"
            detail="会话消息里的「思考」卡片（推理过程）；默认不显示，只保留结论与动作"
            control={
              <Switch
                size="small"
                checked={thinkingMessages.enabled}
                loading={thinkingMessages.saving}
                disabled={thinkingMessages.loading || thinkingMessages.saving}
                onChange={(checked) => {
                  void thinkingMessages.save(checked);
                }}
              />
            }
          />
        </>
      ),
    },
    // 仓库操作快捷键：系统级全局，未聚焦时也可打开当前选中仓库的终端 / 编辑器。
    {
      key: "repoShortcuts",
      title: "仓库操作快捷键",
      content: (
        <>
          <DefaultConfigRow
            title="打开终端"
            hint="全局"
            detail="即使应用未聚焦，也会打开当前选中仓库的终端"
            control={
              <KeyShortcutCapture
                value={openInTerminalShortcut.shortcut}
                disabled={openInTerminalShortcut.loading || openInTerminalShortcut.saving}
                onChange={(chord) => {
                  void openInTerminalShortcut.save(chord);
                }}
              />
            }
          />
          <DefaultConfigRow
            title="打开编辑器"
            hint="全局"
            detail="即使应用未聚焦，也会用编辑器打开当前选中仓库"
            control={
              <KeyShortcutCapture
                value={openInEditorShortcut.shortcut}
                disabled={openInEditorShortcut.loading || openInEditorShortcut.saving}
                onChange={(chord) => {
                  void openInEditorShortcut.save(chord);
                }}
              />
            }
          />
        </>
      ),
    },
    // 开发实验：反馈神经网（含全局规则）。
    {
      key: "dev",
      title: "开发实验",
      content: (
        <>
          <DefaultConfigRow
            title="反馈神经网"
            hint="全链路自我优化"
            detail="在全链路分析 · 洞察中启用轮次分析 → 自我优化闭环；默认关闭"
            control={
              <DefaultConfigOptionPick<"off" | "on">
                aria-label="反馈神经网开发开关"
                disabled={feedbackLoop.loading || feedbackLoop.saving}
                value={feedbackLoop.enabled ? "on" : "off"}
                options={[
                  { label: "关", value: "off" },
                  { label: "开", value: "on" },
                ]}
                onChange={(value) => {
                  void feedbackLoop.saveEnabled(value === "on");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="最大循环"
            hint="1–5 轮"
            control={
              <DefaultConfigOptionPick<"1" | "2" | "3" | "4" | "5">
                aria-label="反馈神经网最大循环次数"
                disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
                value={String(feedbackLoop.maxCycles) as "1" | "2" | "3" | "4" | "5"}
                options={[
                  { label: "1", value: "1" },
                  { label: "2", value: "2" },
                  { label: "3", value: "3" },
                  { label: "4", value: "4" },
                  { label: "5", value: "5" },
                ]}
                onChange={(value) => {
                  void feedbackLoop.saveMaxCycles(Number(value));
                }}
              />
            }
          />

          <DefaultConfigRow
            title="闭环选项"
            hint="开启后可勾选"
            layout="stack"
            control={
              <DefaultConfigCheckboxGrid
                ariaLabel="反馈神经网闭环选项"
                disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
                options={feedbackBehaviorOptions.map((item) => {
                  const artifactGated =
                    item.value === "auto-apply" ||
                    item.value === "auto-verify" ||
                    item.value === "auto-rollback";
                  const globalGated = item.value === "inject-global";
                  return {
                    ...item,
                    checked: artifactGated
                      ? item.checked && feedbackLoop.optimizeConfigArtifacts
                      : globalGated
                        ? item.checked && feedbackLoop.globalRules.length > 0
                        : item.checked,
                    disabled:
                      artifactGated && !feedbackLoop.optimizeConfigArtifacts
                        ? true
                        : globalGated && feedbackLoop.globalRules.length === 0
                          ? true
                          : false,
                  };
                })}
                onToggle={handleFeedbackBehaviorToggle}
              />
            }
          />

          {feedbackLoop.globalRules.length > 0 ? (
            <div className="app-default-config-global-rules" aria-label="全局神经网规则列表">
              {feedbackLoop.globalRules.map((rule) => (
                <div key={rule.id} className="app-default-config-global-rule">
                  <Checkbox
                    checked={rule.enabled}
                    disabled={feedbackLoop.saving}
                    onChange={(e) => {
                      void setFeedbackGlobalRuleEnabled(rule.id, e.target.checked).then(() =>
                        feedbackLoop.refresh(),
                      );
                    }}
                  />
                  <div className="app-default-config-global-rule__body">
                    <span className="app-default-config-global-rule__title">{rule.title}</span>
                    <span className="app-default-config-global-rule__preview">{rule.body}</span>
                  </div>
                  <Button
                    size="small"
                    type="text"
                    danger
                    disabled={feedbackLoop.saving}
                    onClick={() => {
                      void removeFeedbackGlobalRule(rule.id).then(() => feedbackLoop.refresh());
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="app-default-config-row__hint app-default-config-global-rules-empty">
              暂无全局规则。在全链路分析 → 配置补丁中提升全局。
            </p>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="app-default-config-panel">
      {sections.map((section) => (
        <DefaultConfigSection key={section.key} title={section.title}>
          {section.content}
        </DefaultConfigSection>
      ))}
    </div>
  );
}
