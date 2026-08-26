import { Input, Segmented, Switch, message } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { WISE_BROWSE_SESSION_EXAMPLES, type StagehandStartOptions } from "../../services/stagehandBrowse";
import type { useStagehandBrowse } from "../../hooks/useStagehandBrowse";
import "../ClaudeSessions/index.css";

export type BrowserAutomationPanelProps = {
  automation: ReturnType<typeof useStagehandBrowse>;
  disabled?: boolean;
  onClose: () => void;
};

async function copyExample(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`已复制「${text}」，粘贴到会话输入框发送即可`);
  } catch {
    message.info(`请在会话输入框发送：${text}`);
  }
}

export function BrowserAutomationPanel({
  automation,
  disabled = false,
  onClose,
}: BrowserAutomationPanelProps) {
  const running =
    automation.status === "running" ||
    automation.status === "starting" ||
    automation.status === "stopping";
  const inputsDisabled = disabled || automation.busy || automation.status === "stopping";
  const needInstall = !automation.probe?.cliAvailable || !automation.probe?.sidecarReady;

  return (
    <div className="app-run-command-popover__content app-browser-automation-popover__content">
      <header className="app-run-command-popover__header">
        <span className="app-run-command-popover__title">浏览器自动化配置</span>
        <HoverHint
          title="在会话输入框用自然语言操作网页。这里只配置环境、密钥，并安装 wise browse CLI。"
          placement="topLeft"
        >
          <button
            type="button"
            className="app-run-command-popover__hint-btn"
            aria-label="浏览器自动化配置说明"
            onClick={(event) => event.stopPropagation()}
          >
            <svg
              className="app-run-command-popover__hint-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
              <path
                d="M9.75 9.75a2.25 2.25 0 0 1 4.35 1.125c0 1.5-2.1 2.062-2.1 3.375V14.25M12 16.5h.01"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </HoverHint>
      </header>

      <section className="app-run-command-popover__section app-run-command-popover__section--form">
        <p className="app-page-monitor-popover__attach-hint">
          操作入口在会话输入框。点下面的示例可复制，发送后助手会调用 <code>wise browse</code>。
        </p>
        <div className="app-browser-automation-popover__examples">
          {WISE_BROWSE_SESSION_EXAMPLES.map((item) => (
            <button
              key={item.text}
              type="button"
              className="app-browser-automation-popover__chip"
              onClick={() => void copyExample(item.text)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ul className="app-browser-automation-popover__ready">
          {automation.readiness.map((item) => (
            <li key={item.id}>
              <span
                className={
                  item.ok
                    ? "app-browser-automation-popover__ready-ok"
                    : "app-browser-automation-popover__ready-miss"
                }
              >
                {item.ok ? "就绪" : "待办"}
              </span>
              <span className="app-browser-automation-popover__ready-label">{item.label}</span>
              <span className="app-browser-automation-popover__ready-detail" title={item.detail}>
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
        <div className="app-run-command-popover__row app-page-monitor-popover__mode-row">
          <span className="app-run-command-popover__field-label">环境</span>
          <div className="app-run-command-popover__profile-switch">
            <Segmented
              size="small"
              value={automation.env ?? "local"}
              disabled={inputsDisabled}
              onChange={(value) => automation.setEnv(String(value) as StagehandStartOptions["env"])}
              options={[
                { label: "本地", value: "local" },
                { label: "云浏览器", value: "browserbase" },
                { label: "调试口", value: "cdp" },
              ]}
            />
            <label className="app-browser-automation-popover__headed">
              <Switch
                size="small"
                checked={automation.headed}
                disabled={inputsDisabled}
                onChange={automation.setHeaded}
              />
              显示窗口
            </label>
          </div>
        </div>
        <div className="app-run-command-popover__row">
          <span className="app-run-command-popover__field-label">默认网址</span>
          <Input
            size="small"
            value={automation.urlDraft}
            onChange={(event) => automation.setUrlDraft(event.target.value)}
            placeholder="https://www.google.com 或 谷歌"
            disabled={inputsDisabled}
          />
        </div>
        {automation.env === "cdp" ? (
          <div className="app-run-command-popover__row">
            <span className="app-run-command-popover__field-label">调试口</span>
            <Input
              size="small"
              value={automation.cdpUrl}
              onChange={(event) => automation.setCdpUrl(event.target.value)}
              placeholder="9222 或 ws://127.0.0.1:9222/..."
              disabled={inputsDisabled}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="app-browser-automation-popover__advanced-toggle"
          onClick={() => automation.setAdvancedOpen(!automation.advancedOpen)}
        >
          {automation.advancedOpen ? "收起高级设置" : "高级设置（模型 / 密钥）"}
        </button>
        {automation.advancedOpen ? (
          <>
            <div className="app-run-command-popover__row">
              <span className="app-run-command-popover__field-label">模型</span>
              <Input
                size="small"
                value={automation.model}
                onChange={(event) => automation.setModel(event.target.value)}
                placeholder="openai/gpt-4.1 或 anthropic/claude-sonnet-4-5"
                disabled={inputsDisabled}
              />
            </div>
            <div className="app-run-command-popover__row">
              <span className="app-run-command-popover__field-label">模型密钥</span>
              <Input.Password
                size="small"
                value={automation.modelApiKey}
                onChange={(event) => automation.setModelApiKey(event.target.value)}
                placeholder="用于 Act / Extract / Observe"
                disabled={inputsDisabled}
              />
            </div>
            {automation.env === "browserbase" || !automation.probe?.hasBrowserbaseKey ? (
              <div className="app-run-command-popover__row">
                <span className="app-run-command-popover__field-label">云密钥</span>
                <Input.Password
                  size="small"
                  value={automation.browserbaseApiKey}
                  onChange={(event) => automation.setBrowserbaseApiKey(event.target.value)}
                  placeholder="BROWSERBASE_API_KEY"
                  disabled={inputsDisabled}
                />
              </div>
            ) : null}
          </>
        ) : null}
        <p className="app-page-monitor-popover__attach-hint">{automation.probeHint}</p>
      </section>

      <section className="app-run-command-popover__section app-run-command-popover__section--dock">
        <div className="app-run-command-popover__dock">
          <div className="app-run-command-popover__dock-row">
            <span className="app-run-command-popover__dock-label">后台浏览器</span>
            <span className="app-browser-automation-popover__page" title={automation.pageUrl ?? ""}>
              {running
                ? automation.pageTitle || automation.pageUrl || automation.statusHint
                : "未启动（会话里第一次操作时会自动打开）"}
            </span>
          </div>
        </div>
      </section>

      {automation.logs.length > 0 ? (
        <section className="app-run-command-popover__section app-run-command-popover__section--logs">
          <div className="app-run-command-popover__logs">
            {automation.logs.slice(-4).map((line) => (
              <div
                key={`${line.at}-${line.kind}`}
                className={`app-run-command-popover__log-line${
                  line.kind === "error"
                    ? " app-run-command-popover__log-line--error"
                    : line.kind === "info"
                      ? " app-run-command-popover__log-line--info"
                      : ""
                }`}
              >
                <pre className="app-browser-automation-popover__log">{line.text}</pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="app-run-command-popover__footer">
        <button
          type="button"
          className="app-run-command-popover__btn app-run-command-popover__btn--ghost"
          onClick={onClose}
        >
          关闭
        </button>
        <div className="app-run-command-popover__footer-actions">
          <button
            type="button"
            className="app-run-command-popover__btn"
            onClick={() => void automation.installCli()}
            disabled={disabled || automation.busy}
          >
            {automation.busy ? "安装中…" : needInstall ? "安装 CLI" : "重新安装"}
          </button>
          {running ? (
            <button
              type="button"
              className="app-run-command-popover__btn app-run-command-popover__btn--danger"
              onClick={() => void automation.stop()}
              disabled={disabled || automation.status === "stopping"}
            >
              {automation.status === "stopping" ? "停止中…" : "停止浏览器"}
            </button>
          ) : null}
          <button
            type="button"
            className="app-run-command-popover__btn app-run-command-popover__btn--primary app-run-command-popover__btn--footer-main"
            onClick={() => void automation.saveConfig()}
            disabled={disabled || automation.busy}
          >
            {automation.busy ? "保存中…" : automation.dirty ? "保存配置" : "保存配置"}
          </button>
        </div>
      </footer>
    </div>
  );
}
