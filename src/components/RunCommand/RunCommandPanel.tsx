import { Input, Switch, Tooltip } from "antd";
import { openExternalUrl } from "../../services/openExternal";
import type { RunCommandOutputLine, RepositoryRunStatus } from "../../hooks/useRepositoryRunCommand";
import type { RepositoryRunProfile } from "../../utils/detectRepositoryRunProfile";
import { getRunCommandPlaceholder, getRunDebugHint } from "../../utils/detectRepositoryRunProfile";
import "../ClaudeSessions/index.css";

export type RunCommandPanelProps = {
  runCwd: string;
  runCommand: string;
  setRunCommand: (value: string) => void;
  runPreferredUrl: string;
  setRunPreferredUrl: (value: string) => void;
  runStatus: RepositoryRunStatus;
  runStatusHint: string;
  runOutputPreview: RunCommandOutputLine[];
  runDetectedUrl: string | null;
  runErrorMonitorEnabled: boolean;
  setRunErrorMonitorEnabled: (enabled: boolean) => void;
  runAutoOpenPageEnabled: boolean;
  handleRunAutoOpenPageChange: (checked: boolean) => void;
  saveRunCommand: () => void;
  saveRunOpenUrl: () => void;
  resolveOpenUrl: () => string;
  detectedProfile?: RepositoryRunProfile | null;
  detectedProfiles?: RepositoryRunProfile[];
  detectingProfile?: boolean;
  applyDetectedProfile?: (profile?: RepositoryRunProfile) => void;
  selectDetectedProfile?: (profile: RepositoryRunProfile) => void;
  refreshDetectedProfiles?: () => void;
  resolvedDebugCommand?: string | null;
  runCommandLooksStale?: boolean;
  startRun: (options?: { debug?: boolean }) => void | Promise<void>;
  stopRun: () => void | Promise<void>;
  onClose: () => void;
};

export function RunCommandPanel({
  runCwd,
  runCommand,
  setRunCommand,
  runPreferredUrl,
  setRunPreferredUrl,
  runStatus,
  runStatusHint,
  runOutputPreview,
  runDetectedUrl,
  runErrorMonitorEnabled,
  setRunErrorMonitorEnabled,
  runAutoOpenPageEnabled,
  handleRunAutoOpenPageChange,
  saveRunCommand,
  saveRunOpenUrl,
  resolveOpenUrl,
  detectedProfile = null,
  detectedProfiles = [],
  detectingProfile = false,
  applyDetectedProfile,
  selectDetectedProfile,
  refreshDetectedProfiles,
  resolvedDebugCommand = null,
  runCommandLooksStale = false,
  startRun,
  stopRun,
  onClose,
}: RunCommandPanelProps) {
  const inputsDisabled = !runCwd || runStatus === "stopping";
  const showDetectedBanner =
    detectedProfile != null &&
    (runCommandLooksStale || runCommand.trim() !== detectedProfile.runCommand.trim());
  const canDebug = Boolean(resolvedDebugCommand);
  const commandPlaceholder = getRunCommandPlaceholder(detectedProfile);
  const debugHint = getRunDebugHint(detectedProfile);
  const stackLabel = detectedProfile?.stack === "java" ? "Java" : detectedProfile?.stack === "node" ? "Node" : null;
  const hasProfileChoices = detectedProfiles.length > 1;

  return (
    <div className="app-run-command-popover__content">
      <header className="app-run-command-popover__header">
        <span className="app-run-command-popover__title">运行指令</span>
        <div className="app-run-command-popover__header-actions">
          {refreshDetectedProfiles ? (
            <Tooltip title="重新检测 Java / Node 运行配置" mouseEnterDelay={0.3}>
              <button
                type="button"
                className="app-run-command-popover__hint-btn"
                aria-label="重新检测"
                disabled={detectingProfile || !runCwd}
                onClick={(event) => {
                  event.stopPropagation();
                  refreshDetectedProfiles();
                }}
              >
                ↻
              </button>
            </Tooltip>
          ) : null}
          <Tooltip
            title="日志自动识别仅限 localhost / 本机 IP；已保存指定地址时自动打开始终用该地址。优先级：指定 > 检测 > 默认"
            placement="topLeft"
          >
            <button
              type="button"
              className="app-run-command-popover__hint-btn"
              aria-label="运行指令说明"
              onClick={(event) => {
                event.stopPropagation();
              }}
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
        </Tooltip>
        </div>
      </header>

      {detectingProfile ? (
        <div className="app-run-command-popover__detect-hint">正在检测项目运行配置…</div>
      ) : detectedProfile ? (
        <div className={`app-run-command-popover__detect-banner${runCommandLooksStale ? " app-run-command-popover__detect-banner--stale" : ""}`}>
          <div className="app-run-command-popover__detect-copy">
            <div className="app-run-command-popover__detect-head">
              <span className="app-run-command-popover__detect-label">已检测</span>
              {stackLabel ? (
                <span
                  className={`app-run-command-popover__detect-stack app-run-command-popover__detect-stack--${detectedProfile.stack}`}
                >
                  {stackLabel}
                </span>
              ) : null}
            </div>
            <span className="app-run-command-popover__detect-title">{detectedProfile.label}</span>
            {detectedProfile.modulePath ? (
              <span className="app-run-command-popover__detect-meta">模块: {detectedProfile.modulePath}</span>
            ) : null}
            {detectedProfile.defaultUrl ? (
              <span className="app-run-command-popover__detect-meta">{detectedProfile.defaultUrl}</span>
            ) : null}
            {detectedProfile.activeProfiles ? (
              <span className="app-run-command-popover__detect-meta">profile: {detectedProfile.activeProfiles}</span>
            ) : null}
            {runCommandLooksStale ? (
              <span className="app-run-command-popover__detect-meta app-run-command-popover__detect-meta--warn">
                当前命令与检测结果不一致，建议应用新配置
              </span>
            ) : null}
          </div>
          {showDetectedBanner && applyDetectedProfile ? (
            <button
              type="button"
              className="app-run-command-popover__detect-apply"
              onClick={() => applyDetectedProfile(detectedProfile)}
              disabled={inputsDisabled}
            >
              应用
            </button>
          ) : null}
        </div>
      ) : null}

      {hasProfileChoices ? (
        <div className="app-run-command-popover__profile-switch">
          {detectedProfiles.map((profile) => {
            const active = profile.runCommand === detectedProfile?.runCommand && profile.stack === detectedProfile?.stack;
            return (
              <button
                key={`${profile.stack}-${profile.source}-${profile.runCommand}`}
                type="button"
                className={`app-run-command-popover__profile-chip${active ? " is-active" : ""}`}
                onClick={() => {
                  selectDetectedProfile?.(profile);
                  applyDetectedProfile?.(profile);
                }}
                disabled={inputsDisabled}
              >
                {profile.stack === "java" ? "Java" : "Node"}
                <span className="app-run-command-popover__profile-chip-sep">·</span>
                {profile.label.replace(/^(Maven Spring Boot|Spring Boot|Gradle Spring Boot|npm|pnpm|yarn|bun)\s·\s/i, "")}
              </button>
            );
          })}
        </div>
      ) : null}

      <section className="app-run-command-popover__section app-run-command-popover__section--form">
        <label className="app-run-command-popover__row">
          <span className="app-run-command-popover__field-label">运行命令</span>
          <Input
            size="small"
            value={runCommand}
            onChange={(event) => setRunCommand(event.target.value)}
            placeholder={commandPlaceholder}
            disabled={inputsDisabled}
            onPressEnter={() => {
              saveRunCommand();
            }}
            suffix={
              <Tooltip title="保存指令" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  className="app-run-command-popover__suffix-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    saveRunCommand();
                  }}
                  disabled={inputsDisabled}
                >
                  <SaveIcon />
                </button>
              </Tooltip>
            }
          />
        </label>
        <label className="app-run-command-popover__row">
          <span className="app-run-command-popover__field-label">打开地址</span>
          <Input
            size="small"
            value={runPreferredUrl}
            onChange={(event) => setRunPreferredUrl(event.target.value)}
            placeholder="localhost:5173"
            disabled={inputsDisabled}
            onPressEnter={() => {
              saveRunOpenUrl();
            }}
            suffix={
              <Tooltip title="保存地址" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  className="app-run-command-popover__suffix-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    saveRunOpenUrl();
                  }}
                  disabled={inputsDisabled}
                >
                  <SaveIcon />
                </button>
              </Tooltip>
            }
          />
        </label>
        <div className="app-run-command-popover__options-row">
          <div className="app-run-command-popover__option-item">
            <Switch size="small" checked={runAutoOpenPageEnabled} onChange={handleRunAutoOpenPageChange} />
            <span className="app-run-command-popover__option-text">自动打开页面</span>
          </div>
          <div className="app-run-command-popover__option-item">
            <Switch
              size="small"
              checked={runErrorMonitorEnabled}
              onChange={setRunErrorMonitorEnabled}
            />
            <span className="app-run-command-popover__option-text">AI 报错监控</span>
          </div>
        </div>
      </section>

      <section className="app-run-command-popover__section app-run-command-popover__section--dock">
        <div className="app-run-command-popover__dock">
          <div className="app-run-command-popover__dock-row">
            <span className="app-run-command-popover__dock-label">运行状态</span>
            <span
              className={`app-run-command-popover__status-badge app-run-command-popover__status-badge--${runStatus}`}
            >
              {runStatusHint}
            </span>
          </div>
          <div className="app-run-command-popover__dock-row">
            <span className="app-run-command-popover__dock-label">
              {runDetectedUrl ? "检测地址" : "默认地址"}
            </span>
            <button
              type="button"
              className="app-run-command-popover__dock-url-link"
              onClick={() => void openExternalUrl(resolveOpenUrl())}
              title={resolveOpenUrl()}
            >
              <span className="app-run-command-popover__dock-url-text">{resolveOpenUrl()}</span>
              <ExternalLinkIcon />
            </button>
          </div>
        </div>
      </section>

      {runOutputPreview.length > 0 ? (
        <section className="app-run-command-popover__section app-run-command-popover__section--logs">
          <div className="app-run-command-popover__logs">
            {runOutputPreview.map((line, index) => (
              <div
                key={`${index}-${line.text}`}
                className={`app-run-command-popover__log-line${line.isError ? " app-run-command-popover__log-line--error" : ""}`}
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
          {runStatus === "running" || runStatus === "stopping" ? (
            <button
              type="button"
              className="app-run-command-popover__btn app-run-command-popover__btn--danger app-run-command-popover__btn--footer-main"
              onClick={() => void stopRun()}
              disabled={!runCwd || runStatus === "stopping"}
            >
              {runStatus === "stopping" ? "停止中…" : "停止运行"}
            </button>
          ) : (
            <>
              {canDebug ? (
                <Tooltip title={debugHint} placement="top">
                  <button
                    type="button"
                    className="app-run-command-popover__btn app-run-command-popover__btn--ghost app-run-command-popover__btn--footer-main"
                    onClick={() => void startRun({ debug: true })}
                    disabled={!runCwd}
                  >
                    调试
                  </button>
                </Tooltip>
              ) : null}
              <button
                type="button"
                className="app-run-command-popover__btn app-run-command-popover__btn--primary app-run-command-popover__btn--footer-main"
                onClick={() => void startRun()}
                disabled={!runCwd}
              >
                运行
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

function SaveIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="app-run-command-popover__link-icon"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
