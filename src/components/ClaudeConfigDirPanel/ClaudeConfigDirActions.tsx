import { Button, Space } from "antd";

interface Props {
  saving: boolean;
  dirty: boolean;
  canReset: boolean;
  onSave: () => void;
  onReset: () => void;
  onRefresh: () => void;
}

export function ClaudeConfigDirActions({ saving, dirty, canReset, onSave, onReset, onRefresh }: Props) {
  return (
    <Space size={6} className="app-claude-config-dir-panel__actions">
      <Button
        size="small"
        type="primary"
        loading={saving}
        disabled={!dirty}
        onClick={onSave}
        className="app-claude-config-dir-panel__btn-save"
      >
        保存
      </Button>
      <Button
        size="small"
        disabled={saving || !canReset}
        onClick={onReset}
        className="app-claude-config-dir-panel__btn-reset"
      >
        恢复默认
      </Button>
      <Button
        size="small"
        disabled={saving}
        onClick={onRefresh}
        className="app-claude-config-dir-panel__btn-refresh"
      >
        重新读取环境
      </Button>
    </Space>
  );
}
