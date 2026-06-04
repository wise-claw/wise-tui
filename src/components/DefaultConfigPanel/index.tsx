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
import { LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS } from "../../constants/leftSidebarHubQuickEntries";
import type { LeftSidebarHubQuickEntryId } from "../../constants/leftSidebarHubQuickEntries";
import { useClaudeConnectionModeSetting } from "../ClaudeConfigDirPanel/useClaudeConnectionModeSetting";
import { DefaultConfigOptionPick } from "./DefaultConfigOptionPick";
import { useLeftSidebarHubQuickEntriesSetting } from "./useLeftSidebarHubQuickEntriesSetting";
import { useMonitorPanelSetting } from "./useMonitorPanelSetting";
import { useExecutionEnvironmentDispatchHistoryDaysSetting } from "./useExecutionEnvironmentDispatchHistoryDaysSetting";
import { EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS } from "../../constants/executionEnvironmentDispatch";
import { useRightPanelDefaultSetting } from "./useRightPanelDefaultSetting";
import { useTopbarChromeDefaultSetting } from "./useTopbarChromeDefaultSetting";
import { useDefaultTerminalSetting } from "./useDefaultTerminalSetting";
import { useAtMentionDefaultSetting } from "./useAtMentionDefaultSetting";
import { useAtMentionShortcuts } from "../../hooks/useAtMentionShortcuts";
import { KeyShortcutCapture } from "./KeyShortcutCapture";
import type { AtMentionDefaultTarget } from "../../constants/atMentionDefault";
import { useWorkspaceInspectorPanelsSetting } from "./useWorkspaceInspectorPanelsSetting";
import { listEmployees } from "../../services/employees";
import type { EmployeeItem } from "../../types";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import "./index.css";

const DEFAULT_CONFIG_NOTES = [
  "设置写入 SQLite app_settings（wise.defaultConfig.v1），保存后立即作用于主会话顶栏、右栏工作区卡片、运行面板栏位与左栏快捷入口。",
  "默认终端（macOS）写入 wise.ui.default-terminal.v1，用于在资源管理器、Git 面板等位置「在外部终端打开」目录。",
  "Free Claude Code 的安装、启停与 Claude 对齐请在主会话顶栏 FCC 图标弹窗中操作；此处仅控制图标是否显示。",
  "长驻模式使用 --input-format stream-json，与终端 CLI 共享 MCP / Skills / Hooks。",
  "OMC 直连批量、PRD 拆分等编排仍使用独立 -p 子进程，不受会话默认影响。",
  "LLM 流量监听默认隐藏；开启后上游建议填 FCC 地址以便旁路抓包，勿把百炼 sk- key 写入 Claude env。",
] as const;

/** 工作台配置 / 运行设置 / 默认配置：全局会话与布局默认值。 */
export function DefaultConfigPanel() {
  const connection = useClaudeConnectionModeSetting();
  const rightPanel = useRightPanelDefaultSetting();
  const topbarChrome = useTopbarChromeDefaultSetting();
  const hubQuickEntries = useLeftSidebarHubQuickEntriesSetting();
  const monitorPanel = useMonitorPanelSetting();
  const execEnvDispatchHistory = useExecutionEnvironmentDispatchHistoryDaysSetting();
  const atMentionDefault = useAtMentionDefaultSetting();
  const atMentionShortcuts = useAtMentionShortcuts();
  const defaultTerminal = useDefaultTerminalSetting();
  const workspaceInspectorPanels = useWorkspaceInspectorPanelsSetting();
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
            <span className="app-default-config-row__hint">
              全局默认长驻会话；新建标签沿用此项，已打开且单独设置过的标签不变
            </span>
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
            <span className="app-default-config-row__hint">
              启动时右栏展开/收起；顶栏按钮右键可改同一默认
            </span>
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

        <div className="app-default-config-row" aria-label="运行面板">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">运行面板</span>
            <span className="app-default-config-row__hint">
              控制终端、工作流与并发运行态区域是否显示，以及默认展示在左栏或右栏
            </span>
          </div>
          <div className="app-default-config-row__control app-default-config-row__control--monitor">
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
        </div>

        <div className="app-default-config-row" aria-label="@ 默认选中">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">@ 默认选中</span>
            <span className="app-default-config-row__hint">
              主会话输入 @ 打开补全且未输入筛选时，默认高亮的执行环境或终端（与列表键盘焦点一致）
            </span>
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
            <span className="app-default-config-row__hint">
              主会话输入框聚焦时按下组合键，自动插入对应 @ 提及（须含 Mod/Alt/Shift 修饰键；Esc 取消录制）
            </span>
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
            <span className="app-default-config-row__hint">
              左栏「派发任务」默认查询近 N 天的执行环境派发记录；可在列表头临时切换
            </span>
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
            <span className="app-default-config-row__hint">
              控制 Chat / Cockpit 右栏工作区快捷操作卡片；侧栏与数据仍可通过菜单访问
            </span>
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
            <span className="app-default-config-row__hint">
              控制右栏备忘录列表卡片；编辑页与侧栏入口不受此项影响
            </span>
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
            <span className="app-default-config-row__hint">
              控制右栏待办卡片，以及左栏工作区「添加待办事项」菜单与未完成徽章
            </span>
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
            <span className="app-default-config-row__hint">
              勾选后显示在左侧栏顶部；MCP / 技能 / 自动化进入 Cockpit，助手 / 插件市场进入工作台配置
            </span>
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

      <aside className="app-default-config-panel__notes" aria-label="默认配置说明">
        <div className="app-default-config-panel__notes-title">说明</div>
        <ul className="app-default-config-panel__notes-list">
          {DEFAULT_CONFIG_NOTES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Typography.Text type="secondary" className="app-default-config-panel__notes-foot">
          未单独配置时，新建主会话标签默认使用长驻会话。
        </Typography.Text>
      </aside>
    </div>
  );
}
