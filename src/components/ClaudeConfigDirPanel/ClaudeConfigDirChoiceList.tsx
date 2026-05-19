import { Input, Radio, Space, Typography } from "antd";
import { CLAUDE_USER_CONFIG_DIR_PRESETS } from "../../services/claudeConfigDir";
import type { ChoiceKey, ClaudeConfigDirChoiceState } from "./types";

interface Props {
  state: ClaudeConfigDirChoiceState;
  onChoiceChange: (next: ChoiceKey) => void;
  onCustomDraftChange: (next: string) => void;
  onSubmit: () => void;
}

export function ClaudeConfigDirChoiceList({
  state,
  onChoiceChange,
  onCustomDraftChange,
  onSubmit,
}: Props) {
  return (
    <section className="app-claude-config-dir-panel__section" aria-label="切换引擎环境">
      <div className="app-claude-config-dir-panel__section-head">
        <Typography.Text strong>环境预设</Typography.Text>
        <Typography.Text type="secondary">
          切换后，Wise 的用户级 settings、agents、skills、hooks 和插件索引会作为同一个环境接管。
        </Typography.Text>
      </div>
      <Radio.Group
        value={state.choice}
        onChange={(e) => onChoiceChange(e.target.value as ChoiceKey)}
        className="app-claude-config-dir-panel__choices"
      >
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          {CLAUDE_USER_CONFIG_DIR_PRESETS.map((preset) => (
            <Radio key={preset.key} value={preset.key} className="app-claude-config-dir-panel__choice">
              <div className="app-claude-config-dir-panel__choice-body">
                <Typography.Text strong>{preset.label}</Typography.Text>
                <Typography.Text type="secondary" className="app-claude-config-dir-panel__choice-desc">
                  {preset.description}
                </Typography.Text>
              </div>
            </Radio>
          ))}
          <Radio value="custom" className="app-claude-config-dir-panel__choice">
            <div className="app-claude-config-dir-panel__choice-body">
              <Typography.Text strong>自定义路径</Typography.Text>
              <Typography.Text type="secondary" className="app-claude-config-dir-panel__choice-desc">
                支持以 <Typography.Text code>~</Typography.Text>{" "}
                开头或绝对路径；目录可暂不存在，引擎首次使用时会自动创建。
              </Typography.Text>
              <Input
                size="small"
                placeholder="例如：~/.codefuse/engine/cc 或 /Users/me/.claude"
                disabled={state.choice !== "custom"}
                value={state.customDraft}
                onChange={(e) => onCustomDraftChange(e.target.value)}
                onPressEnter={onSubmit}
                className="app-claude-config-dir-panel__custom-input"
              />
            </div>
          </Radio>
        </Space>
      </Radio.Group>
    </section>
  );
}
