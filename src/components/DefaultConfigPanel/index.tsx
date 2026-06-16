import { Button, Checkbox, Select, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
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
import { useLeftSidebarHubQuickEntriesSetting } from "./useLeftSidebarHubQuickEntriesSetting";
import { useMonitorPanelSetting } from "./useMonitorPanelSetting";
import { useLeftSidebarWorkspaceListSetting } from "./useLeftSidebarWorkspaceListSetting";
import { useLeftSidebarRepositoryIconBadgesSetting } from "./useLeftSidebarRepositoryIconBadgesSetting";
import { useExecutionEnvironmentDispatchHistoryDaysSetting } from "./useExecutionEnvironmentDispatchHistoryDaysSetting";
import { EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS } from "../../constants/executionEnvironmentDispatch";
import { useRightPanelDefaultSetting } from "./useRightPanelDefaultSetting";
import { useTopbarChromeDefaultSetting } from "./useTopbarChromeDefaultSetting";
import { useDefaultTerminalSetting } from "./useDefaultTerminalSetting";
import { useAtMentionDefaultSetting } from "./useAtMentionDefaultSetting";
import { useAtMentionShortcuts } from "../../hooks/useAtMentionShortcuts";
import { KeyShortcutCapture } from "./KeyShortcutCapture";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import { useFileTreeOpenInNewPaneSetting } from "./useFileTreeOpenInNewPaneSetting";
import { useRepoPanelPlacementSetting } from "./useRepoPanelPlacementSetting";
import { useWorkspaceInspectorPanelsSetting } from "./useWorkspaceInspectorPanelsSetting";
import { useSessionFeedbackLoopSetting } from "./useSessionFeedbackLoopSetting";
import { listEmployees } from "../../services/employees";
import type { EmployeeItem } from "../../types";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import "./index.css";

/** 工作台配置 / 运行设置 / 默认配置：全局会话与布局默认值。 */
export function DefaultConfigPanel() {
  const connection = useClaudeConnectionModeSetting();
  const rightPanel = useRightPanelDefaultSetting();
  const topbarChrome = useTopbarChromeDefaultSetting();
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
  const fileTreeOpenInNewPane = useFileTreeOpenInNewPaneSetting();
  const feedbackLoop = useSessionFeedbackLoopSetting();
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

  return (
    <div className="app-default-config-panel">
      <section className="app-default-config-panel__settings" aria-label="全局默认项">
        <div className="app-default-config-row" aria-label="会话处理方式">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">会话处理方式</span>
            <span className="app-default-config-row__hint">新建标签默认；已单独设置过的标签不变</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<ClaudeSessionConnectionKind>
              aria-label="会话处理方式"
              disabled={connection.loading || connection.saving}
              value={connection.kind}
              options={[
                { label: "逐轮处理", value: "oneshot" },
                { label: "长驻会话", value: "streaming" },
              ]}
              onChange={(value) => {
                void connection.save(value);
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="右侧面板">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">右侧面板</span>
            <span className="app-default-config-row__hint">启动时展开或收起；顶栏按钮右键可改</span>
          </div>
          <div className="app-default-config-row__control">
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
          </div>
        </div>

        <div className="app-default-config-row" aria-label="工作区">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">工作区</span>
            <span className="app-default-config-row__hint">左栏工作区与仓库树；隐藏后仍可用目录选择器切换</span>
          </div>
          <div className="app-default-config-row__control">
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
        </div>

        <div className="app-default-config-row" aria-label="工作区仓库角标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">工作区仓库角标</span>
            <span className="app-default-config-row__hint">
              左栏工作区列表中仓库前的圆形角标；隐藏后显示文件夹图标
            </span>
          </div>
          <div className="app-default-config-row__control">
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
          </div>
        </div>

        <div className="app-default-config-row" aria-label="运行面板">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">运行面板</span>
            <span className="app-default-config-row__hint">
              终端、派发与工作流合并列表；按可见行数限制高度
            </span>
          </div>
          <div className="app-default-config-row__control app-default-config-row__control--monitor">
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
                  { label: "左栏", value: "left" },
                  { label: "右栏", value: "right" },
                ]}
                onChange={(value) => {
                  void monitorPanel.savePlacement(value);
                }}
              />
            </div>
            <div className="app-default-config-monitor-panel__field app-default-config-monitor-panel__field--rows">
              <span className="app-default-config-monitor-panel__field-label">可见行数</span>
              <Select
                size="small"
                className="app-default-config-monitor-panel__rows-select"
                aria-label="运行面板可见行数"
                disabled={monitorPanel.loading || monitorPanel.saving || !monitorPanel.visible}
                value={monitorPanel.visibleRows}
                options={MONITOR_PANEL_VISIBLE_ROWS_OPTIONS.map((rows) => ({
                  value: rows,
                  label: `${rows} 行`,
                }))}
                onChange={(value) => {
                  void monitorPanel.saveVisibleRows(value);
                }}
              />
            </div>
          </div>
        </div>

        <div className="app-default-config-row" aria-label="Git 与文件树栏位">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">Git 与文件树</span>
            <span className="app-default-config-row__hint">Git 与文件树默认栏位；同在左栏时 Tab 切换</span>
          </div>
          <div className="app-default-config-row__control app-default-config-row__control--monitor">
            <DefaultConfigOptionPick<"left" | "right">
              aria-label="Git 默认栏位"
              disabled={repoPanelPlacement.loading || repoPanelPlacement.saving}
              value={repoPanelPlacement.gitPanelPlacement}
              options={[
                { label: "Git·左栏", value: "left" },
                { label: "Git·右栏", value: "right" },
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
                { label: "文件·左栏", value: "left" },
                { label: "文件·右栏", value: "right" },
              ]}
              onChange={(value) => {
                void repoPanelPlacement.saveFilesPlacement(value);
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="文件树打开方式">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">文件树打开方式</span>
            <span className="app-default-config-row__hint">侧栏文件在当前会话打开或新开一屏</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"current" | "new-pane">
              aria-label="文件树打开方式"
              disabled={fileTreeOpenInNewPane.loading || fileTreeOpenInNewPane.saving}
              value={fileTreeOpenInNewPane.openInNewPane ? "new-pane" : "current"}
              options={[
                { label: "当前会话", value: "current" },
                { label: "新开一屏", value: "new-pane" },
              ]}
              onChange={(value) => {
                void fileTreeOpenInNewPane.save(value === "new-pane");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="@ 默认选中">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">@ 默认选中</span>
            <span className="app-default-config-row__hint">@ 补全无筛选时的默认高亮项</span>
          </div>
          <div className="app-default-config-row__control">
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
          </div>
        </div>

        <div
          className="app-default-config-row app-default-config-row--at-mention-shortcuts"
          aria-label="@ 快捷键"
        >
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">@ 快捷键</span>
            <span className="app-default-config-row__hint">聚焦输入框时按键插入 @ 提及（Esc 取消录制）</span>
          </div>
          <div className="app-default-config-row__control app-default-config-row__control--shortcut-list">
            <ul className="app-default-config-at-mention-shortcuts">
              {atMentionShortcutRows.map((row) => (
                <li key={encodeAtMentionDefaultSelectValue(row.target)} className="app-default-config-at-mention-shortcuts__row">
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
          </div>
        </div>

        <div className="app-default-config-row" aria-label="派发任务历史">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">派发任务历史</span>
            <span className="app-default-config-row__hint">左栏派发任务默认查询天数；列表头可临时切换</span>
          </div>
          <div className="app-default-config-row__control">
            <Select
              size="small"
              aria-label="派发任务默认历史天数"
              disabled={execEnvDispatchHistory.loading || execEnvDispatchHistory.saving}
              value={execEnvDispatchHistory.days}
              options={EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.map((day) => ({
                value: day,
                label: `近 ${day} 天`,
              }))}
              onChange={(value) => {
                void execEnvDispatchHistory.save(value);
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="快捷操作">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">快捷操作</span>
            <span className="app-default-config-row__hint">右栏快捷操作卡片；侧栏菜单仍可访问</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="快捷操作右栏显示"
              disabled={workspaceInspectorPanels.loading || workspaceInspectorPanels.saving}
              value={workspaceInspectorPanels.showWorkspaceQuickActionsPanel ? "visible" : "hidden"}
              options={[
                { label: "隐藏", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void workspaceInspectorPanels.saveQuickActions(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="备忘录">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">备忘录</span>
            <span className="app-default-config-row__hint">右栏备忘录卡片；编辑页入口不受影响</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="备忘录右栏显示"
              disabled={workspaceInspectorPanels.loading || workspaceInspectorPanels.saving}
              value={workspaceInspectorPanels.showWorkspaceMemosPanel ? "visible" : "hidden"}
              options={[
                { label: "隐藏", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void workspaceInspectorPanels.saveMemos(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="待办事项">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">待办事项</span>
            <span className="app-default-config-row__hint">右栏待办与左栏待办菜单、徽章</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="待办事项右栏显示"
              disabled={workspaceInspectorPanels.loading || workspaceInspectorPanels.saving}
              value={workspaceInspectorPanels.showWorkspaceTodosPanel ? "visible" : "hidden"}
              options={[
                { label: "隐藏", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void workspaceInspectorPanels.saveTodos(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row app-default-config-row--hub-quick" aria-label="左栏快捷入口">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">左栏快捷入口</span>
            <span className="app-default-config-row__hint">显示在左栏顶部；入口分别进入 Cockpit / 工作台配置</span>
          </div>
          <div className="app-default-config-row__control app-default-config-row__control--hub-quick">
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
          </div>
        </div>

        <div className="app-default-config-row" aria-label="顶栏仓库名称">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">顶栏仓库名称</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏左侧当前仓库 / 工作区名称；点击名称可复制绝对路径
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="顶栏仓库名称显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showTopbarRepositoryName ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveTopbarRepositoryName(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="远程入口顶栏">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">远程入口</span>
            <span className="app-default-config-row__hint">
              控制中栏顶栏「远程」区（钉钉 / WebSocket 开关与配置入口）；创作台远程入口配置不受影响
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="远程入口顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showRemoteEntryTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveRemoteEntry(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="FCC 顶栏图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">FCC 顶栏图标</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏 Free Claude Code 服务入口；默认不显示
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="FCC 顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showFccTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveFcc(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="OpenCode 代理顶栏图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">OpenCode 代理图标</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏 OpenCode Go / Zen 内置代理入口；默认不显示
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="OpenCode 代理顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showOpencodeProxyTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveOpencodeProxy(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="FCC 请求流量图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">FCC 请求流量</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏 FCC 请求流量监听入口；默认不显示
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="FCC 请求流量顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showFccTrafficTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveFccTraffic(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="LLM 代理图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">LLM 代理图标</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏 LLM 流量监听入口；默认不显示
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="LLM 代理顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showLlmProxyTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveLlmProxy(value === "visible");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="全链路分析图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">全链路分析</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏会话全链路分析入口；默认不显示
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"hidden" | "visible">
              aria-label="全链路分析顶栏显示"
              disabled={topbarChrome.loading || topbarChrome.saving}
              value={topbarChrome.showSessionDataLinkTopbar ? "visible" : "hidden"}
              options={[
                { label: "不显示", value: "hidden" },
                { label: "显示", value: "visible" },
              ]}
              onChange={(value) => {
                void topbarChrome.saveSessionDataLink(value === "visible");
              }}
            />
          </div>
        </div>

        {defaultTerminal.isMac ? (
          <div
            className="app-default-config-row app-default-config-row--terminal"
            aria-label="默认终端"
          >
            <div className="app-default-config-row__main">
              <span className="app-default-config-row__title">默认终端</span>
              <span className="app-default-config-row__hint">
                在外部打开仓库目录时使用的 macOS 终端；可从本机已检测到的应用中任选一项
              </span>
            </div>
            <div className="app-default-config-row__control app-default-config-row__control--terminal">
              {defaultTerminal.detected.length > 0 ? (
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
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="app-default-config-section" aria-label="开发实验功能">
        <Typography.Title level={5} className="app-default-config-section__title">
          开发实验
        </Typography.Title>

        <div className="app-default-config-row" aria-label="反馈神经网">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">反馈神经网</span>
            <span className="app-default-config-row__hint">
              在全链路分析 · 洞察中启用轮次分析 → 自我优化 → 效率/速度/质量比对 → 再优化闭环；默认关闭
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"off" | "on">
              aria-label="反馈神经网开发开关"
              disabled={feedbackLoop.loading || feedbackLoop.saving}
              value={feedbackLoop.enabled ? "on" : "off"}
              options={[
                { label: "关闭", value: "off" },
                { label: "开启", value: "on" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveEnabled(value === "on");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="反馈神经网循环次数">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">最大循环次数</span>
            <span className="app-default-config-row__hint">自我优化 → 比对 的最大轮数（1–5）</span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"1" | "2" | "3" | "4" | "5">
              aria-label="反馈神经网最大循环次数"
              disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
              value={String(feedbackLoop.maxCycles) as "1" | "2" | "3" | "4" | "5"}
              options={[
                { label: "1 轮", value: "1" },
                { label: "2 轮", value: "2" },
                { label: "3 轮", value: "3" },
                { label: "4 轮", value: "4" },
                { label: "5 轮", value: "5" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveMaxCycles(Number(value));
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="反馈神经网自动启动">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">检测到警告时自动启动</span>
            <span className="app-default-config-row__hint">
              打开洞察页且存在警告/严重项时，自动开始第一轮优化
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"off" | "on">
              aria-label="反馈神经网自动启动"
              disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
              value={feedbackLoop.autoStart ? "on" : "off"}
              options={[
                { label: "关闭", value: "off" },
                { label: "开启", value: "on" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveAutoStart(value === "on");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="反馈神经网收敛早停">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">收敛早停</span>
            <span className="app-default-config-row__hint">
              指标改善趋于平稳或连续两轮无提升时提前结束循环
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"off" | "on">
              aria-label="反馈神经网收敛早停"
              disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
              value={feedbackLoop.earlyStopConvergence ? "on" : "off"}
              options={[
                { label: "关闭", value: "off" },
                { label: "开启", value: "on" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveEarlyStopConvergence(value === "on");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="反馈神经网写入常用语">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">闭环完成写入常用语</span>
            <span className="app-default-config-row__hint">
              闭环结束时自动将「神经网习惯」写入 Composer 常用语（可一键插入输入框）
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"off" | "on">
              aria-label="反馈神经网写入常用语"
              disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
              value={feedbackLoop.autoSaveHabitsToComposer ? "on" : "off"}
              options={[
                { label: "关闭", value: "off" },
                { label: "开启", value: "on" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveAutoSaveHabitsToComposer(value === "on");
              }}
            />
          </div>
        </div>

        <div className="app-default-config-row" aria-label="反馈神经网注入 system prompt">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">习惯注入 System Prompt</span>
            <span className="app-default-config-row__hint">
              会话 spawn 时通过 Claude CLI --append-system-prompt 自动追加本仓库神经网习惯（需重启会话生效）
            </span>
          </div>
          <div className="app-default-config-row__control">
            <DefaultConfigOptionPick<"off" | "on">
              aria-label="反馈神经网注入 system prompt"
              disabled={feedbackLoop.loading || feedbackLoop.saving || !feedbackLoop.enabled}
              value={feedbackLoop.injectHabitsToSystemPrompt ? "on" : "off"}
              options={[
                { label: "关闭", value: "off" },
                { label: "开启", value: "on" },
              ]}
              onChange={(value) => {
                void feedbackLoop.saveInjectHabitsToSystemPrompt(value === "on");
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
