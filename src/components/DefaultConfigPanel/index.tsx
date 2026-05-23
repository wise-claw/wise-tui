import { Typography } from "antd";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import { useClaudeConnectionModeSetting } from "../ClaudeConfigDirPanel/useClaudeConnectionModeSetting";
import { DefaultConfigOptionPick } from "./DefaultConfigOptionPick";
import { useRightPanelDefaultSetting } from "./useRightPanelDefaultSetting";
import { useTopbarChromeDefaultSetting } from "./useTopbarChromeDefaultSetting";
import "./index.css";

const DEFAULT_CONFIG_NOTES = [
  "设置写入 SQLite app_settings（wise.defaultConfig.v1），保存后立即作用于主会话顶栏。",
  "Free Claude Code 的安装、启停与 Claude 对齐请在主会话顶栏 FCC 图标弹窗中操作；此处仅控制图标是否显示。",
  "长驻模式使用 --input-format stream-json，与终端 CLI 共享 MCP / Skills / Hooks。",
  "OMC 直连批量、PRD 拆分等编排仍使用独立 -p 子进程，不受会话默认影响。",
  "小窗口模式会强制收起右栏，不受右侧面板默认影响。",
  "LLM 流量监听默认隐藏；开启后上游建议填 FCC 地址以便旁路抓包，勿把百炼 sk- key 写入 Claude env。",
] as const;

/** 工作台配置 / 运行设置 / 默认配置：全局会话与布局默认值。 */
export function DefaultConfigPanel() {
  const connection = useClaudeConnectionModeSetting();
  const rightPanel = useRightPanelDefaultSetting();
  const topbarChrome = useTopbarChromeDefaultSetting();

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

        <div className="app-default-config-row" aria-label="FCC 顶栏图标">
          <div className="app-default-config-row__main">
            <span className="app-default-config-row__title">FCC 顶栏图标</span>
            <span className="app-default-config-row__hint">
              控制主会话顶栏 Free Claude Code 入口；点击图标进行安装、启停与同步
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
