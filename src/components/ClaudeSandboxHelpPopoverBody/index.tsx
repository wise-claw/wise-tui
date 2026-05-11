import { Typography } from "antd";
import "./index.css";

const SANDBOX_DOC = "https://docs.anthropic.com/en/docs/claude-code/sandboxing";
const PERMISSION_MODES_DOC = "https://docs.anthropic.com/en/docs/claude-code/permission-modes";

export function ClaudeSandboxHelpPopoverBody() {
  return (
    <div className="app-claude-sandbox-help">
      <div className="app-claude-sandbox-help__kicker">Claude Code</div>
      <div className="app-claude-sandbox-help__headline">权限模式与 OS 沙箱</div>
      <ul className="app-claude-sandbox-help__list">
        <li>
          <Typography.Text code className="app-claude-sandbox-help__mono">
            bypassPermissions
          </Typography.Text>
          <span className="app-claude-sandbox-help__dash">—</span>
          仅跳过 Claude 侧工具确认流程，不解除 Bash 在操作系统上的沙箱约束（若已启用沙箱）。
        </li>
        <li>
          沙箱默认可写范围通常为<Typography.Text strong>当前工作区</Typography.Text>
          。<Typography.Text code>git</Typography.Text> 写入{" "}
          <Typography.Text code>~/.config/git</Typography.Text>、凭证缓存，或对工作区外的{" "}
          <Typography.Text code>rm</Typography.Text>，可能被 Seatbelt / bubblewrap 拒绝并在终端显示{" "}
          <Typography.Text code>Permission denied</Typography.Text>。
        </li>
      </ul>
      <div className="app-claude-sandbox-help__label">
        配置路径：<Typography.Text code>.claude/settings.json</Typography.Text>（用户级或仓库级）
      </div>
      <pre className="app-claude-sandbox-help__code">{`{
  "sandbox": {
    "enabled": true,
    "filesystem": {
      "allowWrite": ["~/.config/git", "~/.git-credentials", "/tmp"]
    }
  }
}`}</pre>
      <div className="app-claude-sandbox-help__footer">
        <Typography.Text type="secondary" className="app-claude-sandbox-help__footer-note">
          备选：<Typography.Text code>sandbox.excludedCommands</Typography.Text>（如 <Typography.Text code>git</Typography.Text>{" "}
          在沙箱外执行）；不需要沙箱时设 <Typography.Text code>sandbox.enabled</Typography.Text> 为{" "}
          <Typography.Text code>false</Typography.Text>。
        </Typography.Text>
        <div className="app-claude-sandbox-help__links">
          <Typography.Link href={SANDBOX_DOC} target="_blank" rel="noreferrer" className="app-claude-sandbox-help__link">
            沙箱策略
          </Typography.Link>
          <span className="app-claude-sandbox-help__links-sep" aria-hidden>
            |
          </span>
          <Typography.Link href={PERMISSION_MODES_DOC} target="_blank" rel="noreferrer" className="app-claude-sandbox-help__link">
            权限模式
          </Typography.Link>
        </div>
      </div>
    </div>
  );
}
