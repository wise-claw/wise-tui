import { Button, Checkbox, Input, Select, Switch, Typography } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import {
  encodeAtMentionDefaultSelectValue,
  decodeAtMentionDefaultSelectValue,
} from "../../constants/atMentionDefault";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES,
} from "../../constants/sessionExecutionEngine";
import { MONITOR_PANEL_VISIBLE_ROWS_OPTIONS } from "../../constants/monitorPanelLayout";
import { LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS } from "../../constants/leftSidebarHubQuickEntries";
import type { LeftSidebarHubQuickEntryId } from "../../constants/leftSidebarHubQuickEntries";
import { useClaudeConnectionModeSetting } from "../ClaudeConfigDirPanel/useClaudeConnectionModeSetting";
import { DefaultConfigOptionPick } from "./DefaultConfigOptionPick";
import { DefaultConfigRow } from "./DefaultConfigRow";
import { DefaultConfigCheckboxGrid } from "./defaultConfigCheckboxGrid";
import { useLeftSidebarHubQuickEntriesSetting } from "./useLeftSidebarHubQuickEntriesSetting";
import { useMonitorPanelSetting } from "./useMonitorPanelSetting";
import { useLeftSidebarWorkspaceListSetting } from "./useLeftSidebarWorkspaceListSetting";
import { useLeftSidebarRepositoryIconBadgesSetting } from "./useLeftSidebarRepositoryIconBadgesSetting";
import { useExecutionEnvironmentDispatchHistoryDaysSetting } from "./useExecutionEnvironmentDispatchHistoryDaysSetting";
import { EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS } from "../../constants/executionEnvironmentDispatch";
import { useRightPanelDefaultSetting } from "./useRightPanelDefaultSetting";
import { useTopbarChromeDefaultSetting } from "./useTopbarChromeDefaultSetting";
import { useComposerFooterChromeDefaultSetting } from "./useComposerFooterChromeDefaultSetting";
import { useDefaultTerminalSetting } from "./useDefaultTerminalSetting";
import { useClaudeDefaultSettingsSetting } from "./useClaudeDefaultSettingsSetting";
import { ClaudeSettingsJsonEditor } from "../ClaudeSessions/ClaudeSettingsJsonEditor";
import { useCodexDefaultSettingsSetting } from "./useCodexDefaultSettingsSetting";
import { useOpencodeDefaultSettingsSetting } from "./useOpencodeDefaultSettingsSetting";
import { OPENCODE_PERMISSION_PLACEHOLDER } from "./opencodeDefaultSettings";
import { useAtMentionDefaultSetting } from "./useAtMentionDefaultSetting";
import { useAtMentionShortcuts } from "../../hooks/useAtMentionShortcuts";
import { KeyShortcutCapture } from "./KeyShortcutCapture";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import { useFileTreeOpenInNewPaneSetting } from "./useFileTreeOpenInNewPaneSetting";
import { useRepoPanelPlacementSetting } from "./useRepoPanelPlacementSetting";
import { useWorkspaceInspectorPanelsSetting } from "./useWorkspaceInspectorPanelsSetting";
import { useRightInspectorTerminalSetting } from "./useRightInspectorTerminalSetting";
import { useSessionFeedbackLoopSetting } from "./useSessionFeedbackLoopSetting";
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

/** 工作台配置 / 运行设置 / 默认配置：全局会话与布局默认值。 */
export function DefaultConfigPanel() {
  const connection = useClaudeConnectionModeSetting();
  const claudeDefaultSettings = useClaudeDefaultSettingsSetting();
  const codexDefaultSettings = useCodexDefaultSettingsSetting();
  const opencodeDefaultSettings = useOpencodeDefaultSettingsSetting();
  const rightPanel = useRightPanelDefaultSetting();
  const topbarChrome = useTopbarChromeDefaultSetting();
  const composerFooterChrome = useComposerFooterChromeDefaultSetting();
  const hubQuickEntries = useLeftSidebarHubQuickEntriesSetting();
  const monitorPanel = useMonitorPanelSetting();
  const leftSidebarWorkspaceList = useLeftSidebarWorkspaceListSetting();
  const leftSidebarRepositoryIconBadges = useLeftSidebarRepositoryIconBadgesSetting();
  const repoPanelPlacement = useRepoPanelPlacementSetting();
  const execEnvDispatchHistory = useExecutionEnvironmentDispatchHistoryDaysSetting();
  const atMentionDefault = useAtMentionDefaultSetting();
  const atMentionShortcuts = useAtMentionShortcuts();
  const defaultTerminal = useDefaultTerminalSetting();
  const workspaceInspectorPanels = useWorkspaceInspectorPanelsSetting();
  const rightInspectorTerminal = useRightInspectorTerminalSetting();
  const fileTreeOpenInNewPane = useFileTreeOpenInNewPaneSetting();
  const feedbackLoop = useSessionFeedbackLoopSetting();
  const openInTerminalShortcut = useOpenInTerminalShortcutSetting();
  const openInEditorShortcut = useOpenInEditorShortcutSetting();
  const [terminalEmployees, setTerminalEmployees] = useState<EmployeeItem[]>([]);

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
    const engines = SESSION_EXECUTION_ENGINES.map((engine) => ({
      value: encodeAtMentionDefaultSelectValue({ kind: "execution_engine", engine }),
      label: `执行环境 · ${SESSION_EXECUTION_ENGINE_LABELS[engine].title}`,
    }));
    const terminals = terminalEmployees.map((employee) => ({
      value: encodeAtMentionDefaultSelectValue({ kind: "terminal", employeeName: employee.name }),
      label: `终端 · ${employee.name}`,
    }));
    return [...engines, ...terminals];
  }, [terminalEmployees]);

  const atMentionDefaultSelectValue = encodeAtMentionDefaultSelectValue(atMentionDefault.target);

  const atMentionShortcutRows = useMemo(() => {
    const rows: Array<{ target: AtMentionDefaultTarget; label: string; group: string }> = [];
    for (const engine of SESSION_EXECUTION_ENGINES) {
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
        group: "终端",
      });
    }
    return rows;
  }, [terminalEmployees]);

  const topbarToolOptions = useMemo(
    () => [
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

  const sections = [
    {
      key: "session",
      title: "会话",
      content: (
        <>
          <DefaultConfigRow
            title="会话处理方式"
            hint="新建标签默认"
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
            title="Claude 启动 --settings"
            hint="默认配置"
            detail='作为 claude --settings 加载，等同编辑 settings.json；留空不注入。例：{"ultracode": true}'
            layout="stack"
            control={
              <div className="app-default-config-claude-settings">
                <ClaudeSettingsJsonEditor
                  ariaLabel="Claude 启动 --settings JSON"
                  value={claudeDefaultSettings.draft}
                  height={120}
                  readOnly={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                  onChange={claudeDefaultSettings.setDraft}
                  onBlur={() => {
                    if (claudeDefaultSettings.loading || claudeDefaultSettings.saving) return;
                    void claudeDefaultSettings.commit();
                  }}
                />
                <div className="app-default-config-claude-settings__actions">
                  <Button
                    size="small"
                    disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                    onClick={() => {
                      void claudeDefaultSettings.format();
                    }}
                  >
                    格式化
                  </Button>
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
                    取消沙箱限制
                    <Switch
                      size="small"
                      checked={claudeDefaultSettings.sandboxDisabled}
                      disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                      onChange={(checked) => {
                        void claudeDefaultSettings.saveSandboxDisabled(checked);
                      }}
                    />
                  </span>
                  <span className="app-default-config-claude-settings__toggle">
                    权限模式
                    <Select
                      size="small"
                      aria-label="Claude permission-mode"
                      disabled={claudeDefaultSettings.loading || claudeDefaultSettings.saving}
                      value={claudeDefaultSettings.permissionMode ?? ""}
                      onChange={(v: string) => {
                        void claudeDefaultSettings.savePermissionMode(v || null);
                      }}
                      style={{ minWidth: 168 }}
                      options={[
                        { label: "默认 (bypassPermissions)", value: "" },
                        { label: "default", value: "default" },
                        { label: "acceptEdits", value: "acceptEdits" },
                        { label: "plan", value: "plan" },
                        { label: "bypassPermissions", value: "bypassPermissions" },
                      ]}
                    />
                  </span>
                </div>
              </div>
            }
          />
          <DefaultConfigRow
            title="Codex 沙箱/审批"
            hint="默认配置"
            detail="codex exec 新会话注入 -s sandbox_mode 与 -c approval_policy；resume 沿用原会话。留空=workspace-write（现状）"
            layout="stack"
            control={
              <div className="app-default-config-cli-settings">
                <div className="app-default-config-cli-settings__actions">
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
                      style={{ minWidth: 168 }}
                      options={[
                        { label: "默认 (workspace-write)", value: "" },
                        { label: "read-only", value: "read-only" },
                        { label: "workspace-write", value: "workspace-write" },
                        { label: "danger-full-access", value: "danger-full-access" },
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
                      style={{ minWidth: 124 }}
                      options={[
                        { label: "默认", value: "" },
                        { label: "untrusted", value: "untrusted" },
                        { label: "on-request", value: "on-request" },
                        { label: "never", value: "never" },
                      ]}
                    />
                  </span>
                  <span className="app-default-config-cli-settings__toggle">
                    取消沙箱限制
                    <Switch
                      size="small"
                      checked={codexDefaultSettings.fullAccess}
                      disabled={codexDefaultSettings.loading || codexDefaultSettings.saving}
                      onChange={(checked) => {
                        void codexDefaultSettings.saveFullAccess(checked);
                      }}
                    />
                  </span>
                </div>
              </div>
            }
          />
          <DefaultConfigRow
            title="OpenCode 权限"
            hint="默认配置"
            detail="自动批准=--dangerously-skip-permissions（现状）；自定义规则=移除 skip，改用 OPENCODE_PERMISSION 注入 allow/ask/deny 规则"
            layout="stack"
            control={
              <div className="app-default-config-cli-settings">
                <div className="app-default-config-cli-settings__actions">
                  <span className="app-default-config-cli-settings__toggle">
                    权限模式
                    <Select
                      size="small"
                      aria-label="OpenCode 权限模式"
                      disabled={opencodeDefaultSettings.loading || opencodeDefaultSettings.saving}
                      value={opencodeDefaultSettings.mode}
                      onChange={(v: string) => {
                        void opencodeDefaultSettings.saveMode(v as "auto" | "custom");
                      }}
                      style={{ minWidth: 124 }}
                      options={[
                        { label: "自动批准", value: "auto" },
                        { label: "自定义规则", value: "custom" },
                      ]}
                    />
                  </span>
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
                    autoSize={{ minRows: 3, maxRows: 10 }}
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
      key: "layout",
      title: "布局",
      content: (
        <>
          <DefaultConfigRow
            title="右侧面板"
            hint="启动默认"
            detail="启动时展开或收起；顶栏按钮右键可改"
            control={
              <DefaultConfigOptionPick<"expanded" | "collapsed">
                aria-label="右侧面板默认状态"
                disabled={rightPanel.loading || rightPanel.saving}
                value={rightPanel.collapsed ? "collapsed" : "expanded"}
                options={[
                  { label: "展开", value: "expanded" },
                  { label: "收起", value: "collapsed" },
                ]}
                onChange={(value) => {
                  void rightPanel.save(value === "collapsed");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="工作区树"
            hint="左栏"
            detail="左栏工作区与仓库树；隐藏后仍可用目录选择器切换"
            control={
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
            }
          />

          <DefaultConfigRow
            title="仓库角标"
            hint="列表前置图标"
            detail="左栏工作区列表中仓库前的圆形角标"
            control={
              <DefaultConfigOptionPick<"hidden" | "visible">
                aria-label="左栏工作区仓库角标默认显示"
                disabled={
                  leftSidebarRepositoryIconBadges.loading || leftSidebarRepositoryIconBadges.saving
                }
                value={leftSidebarRepositoryIconBadges.visible ? "visible" : "hidden"}
                options={[
                  { label: "显示", value: "visible" },
                  { label: "隐藏", value: "hidden" },
                ]}
                onChange={(value) => {
                  void leftSidebarRepositoryIconBadges.saveVisible(value === "visible");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="运行面板"
            hint="终端 / 派发 / 工作流"
            detail="终端、派发与工作流合并列表；按可见行数限制高度"
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
            title="Git / 文件树"
            hint="默认栏位"
            detail="Git 与文件树默认栏位；同在左栏时 Tab 切换"
            control={
              <div className="app-default-config-row__control--monitor">
                <DefaultConfigOptionPick<"left" | "right">
                  aria-label="Git 默认栏位"
                  disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
                  value={repoPanelPlacement.gitPanelPlacement}
                  options={[
                    { label: "Git·左", value: "left" },
                    { label: "Git·右", value: "right" },
                  ]}
                  onChange={(value) => {
                    void repoPanelPlacement.saveGitPlacement(value);
                  }}
                />
                <DefaultConfigOptionPick<"left" | "right">
                  aria-label="文件树默认栏位"
                  disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
                  value={repoPanelPlacement.filesPanelPlacement}
                  options={[
                    { label: "文件·左", value: "left" },
                    { label: "文件·右", value: "right" },
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
            hint="Git / 文件树"
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
            title="右栏卡片"
            hint="快捷操作 / 待办"
            control={
              <div className="app-default-config-row__control--monitor">
                <DefaultConfigOptionPick<"hidden" | "visible">
                  aria-label="快捷操作右栏显示"
                  disabled={workspaceInspectorPanels.loading || workspaceInspectorPanels.saving}
                  value={
                    workspaceInspectorPanels.showWorkspaceQuickActionsPanel ? "visible" : "hidden"
                  }
                  options={[
                    { label: "快捷·显", value: "visible" },
                    { label: "快捷·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    void workspaceInspectorPanels.saveQuickActions(value === "visible");
                  }}
                />
                <DefaultConfigOptionPick<"hidden" | "visible">
                  aria-label="待办事项右栏显示"
                  disabled={workspaceInspectorPanels.loading || workspaceInspectorPanels.saving}
                  value={workspaceInspectorPanels.showWorkspaceTodosPanel ? "visible" : "hidden"}
                  options={[
                    { label: "待办·显", value: "visible" },
                    { label: "待办·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    void workspaceInspectorPanels.saveTodos(value === "visible");
                  }}
                />
              </div>
            }
          />

          <DefaultConfigRow
            title="右栏运行/终端"
            hint="顶部分别显示"
            detail="「运行」与「终端」两个独立开关：均关闭时右栏顶部不展示 Tab。"
            control={
              <div className="app-default-config-row__control--monitor">
                <DefaultConfigOptionPick<"hidden" | "visible">
                  aria-label="运行面板右栏顶部显示"
                  disabled={monitorPanel.loading || monitorPanel.saving}
                  value={
                    monitorPanel.visible && monitorPanel.placement === "right" ? "visible" : "hidden"
                  }
                  options={[
                    { label: "运行·显", value: "visible" },
                    { label: "运行·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    const shouldShow = value === "visible";
                    void (async () => {
                      if (shouldShow) {
                        if (monitorPanel.placement !== "right") {
                          await monitorPanel.savePlacement("right");
                        }
                        if (!monitorPanel.visible) {
                          await monitorPanel.saveVisible(true);
                        }
                      } else if (monitorPanel.visible && monitorPanel.placement === "right") {
                        // 用户明确把右栏运行关掉,改放到左栏,避免"两个开关都关"导致运行消失。
                        await monitorPanel.savePlacement("left");
                      }
                    })();
                  }}
                />
                <DefaultConfigOptionPick<"hidden" | "visible">
                  aria-label="终端右栏顶部显示"
                  disabled={rightInspectorTerminal.loading || rightInspectorTerminal.saving}
                  value={rightInspectorTerminal.visible ? "visible" : "hidden"}
                  options={[
                    { label: "终端·显", value: "visible" },
                    { label: "终端·隐", value: "hidden" },
                  ]}
                  onChange={(value) => {
                    void rightInspectorTerminal.save(value === "visible");
                  }}
                />
              </div>
            }
          />

          <DefaultConfigRow
            title="左栏快捷入口"
            hint="顶栏图标"
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
        </>
      ),
    },
    {
      key: "topbar",
      title: "顶栏",
      content: (
        <>
          <DefaultConfigRow
            title="仓库名称"
            hint="点击复制路径"
            detail="主会话顶栏左侧当前仓库 / 工作区名称"
            control={
              <DefaultConfigOptionPick<"hidden" | "visible">
                aria-label="顶栏仓库名称显示"
                disabled={topbarChrome.loading || topbarChrome.saving}
                value={topbarChrome.showTopbarRepositoryName ? "visible" : "hidden"}
                options={[
                  { label: "隐藏", value: "hidden" },
                  { label: "显示", value: "visible" },
                ]}
                onChange={(value) => {
                  void topbarChrome.saveTopbarRepositoryName(value === "visible");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="远程入口"
            hint="中栏顶栏"
            detail="钉钉 / WebSocket 开关与配置；创作台远程配置不受影响"
            control={
              <DefaultConfigOptionPick<"hidden" | "visible">
                aria-label="远程入口顶栏显示"
                disabled={topbarChrome.loading || topbarChrome.saving}
                value={topbarChrome.showRemoteEntryTopbar ? "visible" : "hidden"}
                options={[
                  { label: "隐藏", value: "hidden" },
                  { label: "显示", value: "visible" },
                ]}
                onChange={(value) => {
                  void topbarChrome.saveRemoteEntry(value === "visible");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="顶栏终端"
            hint="IDE 左侧"
            detail="主会话顶栏 OpenAppMenu 左侧的终端打开按钮"
            control={
              <DefaultConfigOptionPick<"hidden" | "visible">
                aria-label="顶栏终端按钮显示"
                disabled={topbarChrome.loading || topbarChrome.saving}
                value={topbarChrome.showTopbarOpenInTerminal ? "visible" : "hidden"}
                options={[
                  { label: "隐藏", value: "hidden" },
                  { label: "显示", value: "visible" },
                ]}
                onChange={(value) => {
                  void topbarChrome.saveTopbarOpenInTerminal(value === "visible");
                }}
              />
            }
          />

          <DefaultConfigRow
            title="工具图标"
            hint="默认均隐藏"
            detail="主会话顶栏实验 / 诊断类图标；隐藏后部分仍可从「更多」打开"
            layout="stack"
            control={
              <DefaultConfigCheckboxGrid
                ariaLabel="顶栏工具图标显示"
                disabled={topbarChrome.loading || topbarChrome.saving}
                options={topbarToolOptions}
                onToggle={handleTopbarToolToggle}
              />
            }
          />
        </>
      ),
    },
    {
      key: "runtime",
      title: "运行",
      content: (
        <>
          <DefaultConfigRow
            title="派发历史"
            hint="左栏默认天数"
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

          {defaultTerminal.isMac ? (
            <DefaultConfigRow
              title="默认终端"
              hint="外部打开目录"
              detail="在外部打开仓库目录时使用的 macOS 终端"
              layout="stack"
              control={
                defaultTerminal.detected.length > 0 ? (
                  <div className="app-default-config-terminal-picker">
                    <Select
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
        </>
      ),
    },
    {
      key: "shortcuts",
      title: "快捷键",
      content: (
        <>
          <DefaultConfigRow
            title="打开终端"
            hint="仓库列表"
            detail="在仓库列表中快速打开当前选中仓库的终端"
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
            hint="仓库列表"
            detail="在仓库列表中快速用编辑器打开当前选中仓库"
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
