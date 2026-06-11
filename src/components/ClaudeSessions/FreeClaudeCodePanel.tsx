import { CloseOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { Button, Progress, Spin, Typography } from "antd";
import {
  FREE_CLAUDE_CODE_QUICK_START_URL,
  FREE_CLAUDE_CODE_REPO_URL,
} from "../../services/freeClaudeCode";
import {
  buildFccDependencyRows,
  buildFccSummaryMessage,
} from "../../services/freeClaudeCodePanelCopy";
import type { useFreeClaudeCodeSetting } from "../DefaultConfigPanel/useFreeClaudeCodeSetting";
import "./FreeClaudeCodePanel.css";

export type FreeClaudeCodePanelController = ReturnType<typeof useFreeClaudeCodeSetting>;

interface Props {
  fcc: FreeClaudeCodePanelController;
  onClose?: () => void;
}

function ReadyTag({ ready }: { ready: boolean }) {
  return (
    <span
      className={
        "app-fcc-topbar-panel__tag" +
        (ready ? " app-fcc-topbar-panel__tag--ready" : " app-fcc-topbar-panel__tag--pending")
      }
    >
      {ready ? "就绪" : "未就绪"}
    </span>
  );
}

/** 顶栏 Popover：Free Claude Code 依赖检查、安装与启停（对齐 FCC 原版面板）。 */
export function FreeClaudeCodePanel({ fcc, onClose }: Props) {
  const st = fcc.status;
  const disabled = fcc.loading || fcc.busy;
  const running = st?.serverRunning ?? false;
  const installed = st?.installed ?? false;
  const claudeAligned = st?.claudeSettingsAligned ?? false;
  const canInstall = !disabled && (!installed || !running);
  const canUninstall = !disabled && installed && !running;
  const uninstallBlockedReason = installed && running ? "请先点击「停止」后再卸载" : undefined;
  const claudeLabel = !running ? "Claude —" : claudeAligned ? "Claude 已对齐" : "Claude 未对齐";

  const summary = st != null ? buildFccSummaryMessage(st) : "无法读取状态";
  const rows = st ? buildFccDependencyRows(st) : [];
  const summaryPending = fcc.loading && !st;

  return (
    <div className="app-fcc-topbar-panel" aria-label="Free Claude Code">
      <header className="app-fcc-topbar-panel__head">
        <div className="app-fcc-topbar-panel__title-row">
          <span className="app-fcc-topbar-panel__title-group">
            <span className="app-fcc-topbar-panel__title">Free Claude Code</span>
            <HoverHint
              title={
                <>
                  本机 Anthropic 兼容代理（
                  <Typography.Link href={FREE_CLAUDE_CODE_REPO_URL} target="_blank" rel="noreferrer">
                    free-claude-code
                  </Typography.Link>
                  ）；Provider Key 在 Admin UI 配置。
                </>
              }
            >
              <button
                type="button"
                className="app-fcc-topbar-panel__help"
                aria-label="Free Claude Code 说明"
              >
                <QuestionCircleOutlined />
              </button>
            </HoverHint>
          </span>
          <span className="app-fcc-topbar-panel__head-actions">
            <Button
              type="link"
              size="small"
              className="app-fcc-topbar-panel__refresh"
              disabled={disabled}
              onClick={() => void fcc.refresh()}
            >
              刷新
            </Button>
            {onClose ? (
              <button
                type="button"
                className="app-fcc-topbar-panel__close"
                aria-label="关闭"
                onClick={onClose}
              >
                <CloseOutlined />
              </button>
            ) : null}
          </span>
        </div>
        <Typography.Paragraph className="app-fcc-topbar-panel__summary">
          {summaryPending ? (
            <>
              <Spin size="small" className="app-fcc-topbar-panel__summary-spin" />
              正在检查依赖…
            </>
          ) : (
            summary
          )}
        </Typography.Paragraph>
      </header>

      {running ? (
        <div className="app-fcc-topbar-panel__status-bar" aria-label="Claude 配置状态">
          <span
            className={
              "app-fcc-topbar-panel__chip" +
              (claudeAligned
                ? " app-fcc-topbar-panel__chip--on"
                : " app-fcc-topbar-panel__chip--warn app-fcc-topbar-panel__chip--action")
            }
            role={!claudeAligned ? "button" : undefined}
            tabIndex={!claudeAligned ? 0 : undefined}
            title={!claudeAligned ? "点击同步 Claude settings.json" : undefined}
            onClick={
              !claudeAligned && !disabled
                ? () => void fcc.applyClaudeSettings()
                : undefined
            }
            onKeyDown={
              !claudeAligned && !disabled
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void fcc.applyClaudeSettings();
                    }
                  }
                : undefined
            }
          >
            {claudeLabel}
          </span>
        </div>
      ) : null}

      <ul className="app-fcc-topbar-panel__deps" aria-label="依赖状态">
        {rows.map((row) => (
          <li key={row.id} className="app-fcc-topbar-panel__dep">
            <span className="app-fcc-topbar-panel__dep-label">
              {row.label}
              <HoverHint title={row.help}>
                <button
                  type="button"
                  className="app-fcc-topbar-panel__help app-fcc-topbar-panel__help--inline"
                  aria-label={`${row.label} 说明`}
                >
                  <QuestionCircleOutlined />
                </button>
              </HoverHint>
            </span>
            <ReadyTag ready={row.ready} />
          </li>
        ))}
      </ul>

      {fcc.installing ? (
        <div className="app-fcc-topbar-panel__install-progress">
          <Progress
            size="small"
            percent={fcc.installProgress ?? undefined}
            status="active"
            showInfo={fcc.installProgress != null}
          />
          <span className="app-fcc-topbar-panel__install-message">
            {fcc.installMessage ?? "正在安装 free-claude-code…"}
          </span>
        </div>
      ) : null}

      <div className="app-fcc-topbar-panel__actions">
        <HoverHint
          title={
            installed && running
              ? "代理运行中无法重装，请先停止"
              : installed
                ? "重新执行 uv tool install（覆盖更新）"
                : undefined
          }
        >
          <span className="app-fcc-topbar-panel__action-wrap">
            <Button
              type={installed ? "default" : "primary"}
              size="small"
              className="app-fcc-topbar-panel__action-btn"
              disabled={!canInstall}
              onClick={() => void fcc.install()}
            >
              {installed ? "重新安装" : "一键安装"}
            </Button>
          </span>
        </HoverHint>
        <HoverHint title={uninstallBlockedReason}>
          <span className="app-fcc-topbar-panel__action-wrap">
            <Button
              size="small"
              danger
              className="app-fcc-topbar-panel__action-btn"
              disabled={!canUninstall}
              onClick={() => fcc.uninstall()}
            >
              一键卸载
            </Button>
          </span>
        </HoverHint>
        <Button
          type={installed ? "primary" : "default"}
          size="small"
          className="app-fcc-topbar-panel__action-btn"
          disabled={disabled || !installed}
          onClick={() =>
            void (running ? fcc.stopServer() : fcc.startServer())
          }
        >
          {running ? "停止" : "启动"}
        </Button>
        <Button
          size="small"
          className="app-fcc-topbar-panel__action-btn"
          disabled={disabled || !running}
          onClick={() => void fcc.openAdmin()}
        >
          Admin UI
        </Button>
        <Button
          size="small"
          className="app-fcc-topbar-panel__action-btn"
          disabled={disabled || !running || claudeAligned}
          onClick={() => void fcc.applyClaudeSettings()}
        >
          同步 Claude 设置
        </Button>
        <Button
          size="small"
          className="app-fcc-topbar-panel__action-btn app-fcc-topbar-panel__action-btn--close"
          disabled={disabled}
          onClick={() => onClose?.()}
        >
          关闭
        </Button>
      </div>

      <footer className="app-fcc-topbar-panel__foot">
        <Typography.Link href={FREE_CLAUDE_CODE_QUICK_START_URL} target="_blank" rel="noreferrer">
          Quick Start 文档
        </Typography.Link>
      </footer>
    </div>
  );
}
