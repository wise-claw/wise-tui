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
    <Space size={8} className="app-claude-config-dir-panel__actions">
      <Button type="primary" loading={saving} disabled={!dirty} onClick={onSave}>
        保存
      </Button>
      <Button disabled={saving || !canReset} onClick={onReset}>
        恢复默认
      </Button>
      <Button disabled={saving} onClick={onRefresh}>
        重新读取环境
      </Button>
    </Space>
  );
}
