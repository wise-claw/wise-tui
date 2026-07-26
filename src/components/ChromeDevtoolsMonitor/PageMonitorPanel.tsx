import { Input, Switch } from "antd";
import { HoverHint } from "../shared/HoverHint";
import type { PageMonitorChromeMode } from "../../services/chromeDevtoolsMonitor";
import type { PageMonitorIssueLine, PageMonitorStatus } from "../../stores/chromeDevtoolsMonitorRuntimeStore";
import "../ClaudeSessions/index.css";

export type PageMonitorPanelProps = {
  urlDraft: string;
  setUrlDraft: (value: string) => void;
  autoFixEnabled: boolean;
  setAutoFixEnabled: (enabled: boolean) => void;
  chromeMode: PageMonitorChromeMode;
  setChromeMode: (mode: PageMonitorChromeMode) => void;
  debugPortDraft: string;
  setDebugPortDraft: (value: string) => void;
  status: PageMonitorStatus;
  statusHint: string;
  issuePreview: PageMonitorIssueLine[];
  saveUrl: () => boolean;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  downloadExtension?: () => void | Promise<void>;
  onClose: () => void;
  disabled?: boolean;
};

export function PageMonitorPanel({
  urlDraft,
  setUrlDraft,
  autoFixEnabled,
  setAutoFixEnabled,
  chromeMode,
  setChromeMode,
  debugPortDraft,
  setDebugPortDraft,
  status,
  statusHint,
  issuePreview,
  saveUrl,
  start,
  stop,
  downloadExtension,
  onClose,
  disabled = false,
}: PageMonitorPanelProps) {
  const inputsDisabled = disabled || status === "stopping" || status === "starting";
  const monitoring = status === "monitoring" || status === "starting" || status === "stopping";
  const attachMode = chromeMode === "attach";
  const extensionMode = chromeMode === "extension";

  return (
    <div className="app-run-command-popover__content app-page-monitor-popover__content">
      <header className="app-run-command-popover__header">
        <span className="app-run-command-popover__title">页面监控</span>
        <HoverHint
          title="经 CDP / Chrome 扩展监听页面异常、console 报错/告警、接口 4xx/5xx 与网络失败。「独立窗口」另开专用 Chrome；「附着已有」需 --remote-debugging-port；「Chrome 扩展」监控日常 Chrome 标签。"
          placement="topLeft"
        >
          <button
            type="button"
            className="app-run-command-popover__hint-btn"
            aria-label="页面监控说明"
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
        <div className="app-run-command-popover__row app-page-monitor-popover__mode-row">
          <span className="app-run-command-popover__field-label">模式</span>
          <div className="app-run-command-popover__profile-switch" role="group" aria-label="Chrome 监控模式">
            <button
              type="button"
              className={
                "app-run-command-popover__profile-chip" +
                (chromeMode === "extension" ? " is-active" : "")
              }
              disabled={inputsDisabled}
              onClick={() => setChromeMode("extension")}
              title="通过已安装的 Wise 扩展监控日常 Chrome 标签"
            >
              Chrome 扩展
            </button>
            <span className="app-run-command-popover__profile-chip-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              className={
                "app-run-command-popover__profile-chip" + (chromeMode === "launch" ? " is-active" : "")
              }
              disabled={inputsDisabled}
              onClick={() => setChromeMode("launch")}
            >
              独立窗口
            </button>
            <span className="app-run-command-popover__profile-chip-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              className={
                "app-run-command-popover__profile-chip" + (chromeMode === "attach" ? " is-active" : "")
              }
              disabled={inputsDisabled}
              onClick={() => setChromeMode("attach")}
              title="附着已用 --remote-debugging-port 启动的 Chrome"
            >
              附着已有
            </button>
          </div>
        </div>

        <label className="app-run-command-popover__row">
          <span className="app-run-command-popover__field-label">监控地址</span>
          <Input
            size="small"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="localhost:5173"
            disabled={inputsDisabled}
            onPressEnter={() => {
              saveUrl();
            }}
          />
        </label>

        {attachMode ? (
          <label className="app-run-command-popover__row">
            <span className="app-run-command-popover__field-label">调试口</span>
            <Input
              size="small"
              value={debugPortDraft}
              onChange={(event) => setDebugPortDraft(event.target.value)}
              placeholder="9222"
              disabled={inputsDisabled}
              inputMode="numeric"
            />
          </label>
        ) : null}

        {attachMode ? (
          <p className="app-page-monitor-popover__attach-hint">
            先启动：Google Chrome --remote-debugging-port={debugPortDraft || "9222"}
          </p>
        ) : null}

        {extensionMode ? (
          <div className="app-page-monitor-popover__attach-hint app-page-monitor-popover__ext-hint">
            <p>
              先下载扩展，再在 chrome://extensions → 开发者模式 →「加载已解压扩展」选择下载目录。页顶可能出现「正在调试」提示，属正常。
            </p>
            {downloadExtension ? (
              <button
                type="button"
                className="app-page-monitor-popover__link-btn"
                disabled={disabled}
                onClick={() => void downloadExtension()}
              >
                下载扩展
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="app-run-command-popover__options-row">
          <div className="app-run-command-popover__option-item">
            <Switch
              size="small"
              checked={autoFixEnabled}
              onChange={setAutoFixEnabled}
              disabled={inputsDisabled}
            />
            <span
              className="app-run-command-popover__option-text"
              title="命中页面问题后自动交给 Claude Code 修复"
            >
              AI 自动修复
            </span>
          </div>
        </div>
      </section>

      <section className="app-run-command-popover__section app-run-command-popover__section--dock">
        <div className="app-run-command-popover__dock">
          <div className="app-run-command-popover__dock-row">
            <span className="app-run-command-popover__dock-label">监控状态</span>
            <span
              className={`app-run-command-popover__status-badge app-run-command-popover__status-badge--${
                monitoring ? "running" : "idle"
              }`}
            >
              {statusHint}
            </span>
          </div>
        </div>
      </section>

      {issuePreview.length > 0 ? (
        <section className="app-run-command-popover__section app-run-command-popover__section--logs">
          <div className="app-run-command-popover__logs">
            {issuePreview.map((line, index) => (
              <div
                key={`${index}-${line.text}`}
                className={`app-run-command-popover__log-line${
                  line.kind !== "warning" ? " app-run-command-popover__log-line--error" : ""
                }`}
              >
                {line.text}
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
          {monitoring ? (
            <button
              type="button"
              className="app-run-command-popover__btn app-run-command-popover__btn--danger app-run-command-popover__btn--footer-main"
              onClick={() => void stop()}
              disabled={disabled || status === "stopping"}
            >
              {status === "stopping" ? "停止中…" : "停止监控"}
            </button>
          ) : (
            <button
              type="button"
              className="app-run-command-popover__btn app-run-command-popover__btn--primary app-run-command-popover__btn--footer-main"
              onClick={() => void start()}
              disabled={disabled}
            >
              开始监控
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
