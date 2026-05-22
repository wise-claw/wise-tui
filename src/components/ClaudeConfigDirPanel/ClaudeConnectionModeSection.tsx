import { Alert, Radio, Space, Typography } from "antd";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import { useClaudeConnectionModeSetting } from "./useClaudeConnectionModeSetting";

export function ClaudeConnectionModeSection() {
  const { kind, loading, saving, save, labels } = useClaudeConnectionModeSetting();

  const handleChange = (next: ClaudeSessionConnectionKind) => {
    void save(next);
  };

  return (
    <section className="app-claude-config-dir-panel__section" aria-label="主会话连接方式">
      <div className="app-claude-config-dir-panel__section-head">
        <Typography.Text strong>主会话连接方式</Typography.Text>
        <Typography.Text type="secondary">
          控制 Composer 新建标签如何拉起 Claude Code。已打开的标签保持创建时的设置，直至关闭。
        </Typography.Text>
      </div>

      <Radio.Group
        value={kind}
        disabled={loading || saving}
        onChange={(e) => handleChange(e.target.value as ClaudeSessionConnectionKind)}
        className="app-claude-config-dir-panel__choices"
      >
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          {(["streaming", "oneshot"] as const).map((key) => {
            const meta = labels[key];
            const isActive = kind === key;
            return (
              <Radio
                key={key}
                value={key}
                className={`app-claude-config-dir-panel__choice${
                  isActive ? " app-claude-config-dir-panel__choice--active" : ""
                }`}
              >
                <div className="app-claude-config-dir-panel__choice-body">
                  <Typography.Text strong>{meta.title}</Typography.Text>
                  <Typography.Text type="secondary" className="app-claude-config-dir-panel__choice-desc">
                    {meta.description}
                  </Typography.Text>
                </div>
              </Radio>
            );
          })}
        </Space>
      </Radio.Group>

      <Alert
        showIcon
        type="info"
        className="app-claude-config-dir-panel__hint"
        title="说明"
        description={
          <ul className="app-claude-config-dir-panel__hint-list">
            <li>长驻模式使用 <Typography.Text code>--input-format stream-json</Typography.Text>，与终端 CLI 共享 MCP / Skills / Hooks 加载链路。</li>
            <li>OMC 直连批量、PRD 拆分等编排仍使用独立 <Typography.Text code>-p</Typography.Text> 子进程，不受此项影响。</li>
          </ul>
        }
      />
    </section>
  );
}
