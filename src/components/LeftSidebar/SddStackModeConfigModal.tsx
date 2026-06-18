import { Modal, Space, Typography } from "antd";
import { resolveAutoSddMode, type SddSignals } from "../../services/sddModeDetector";
import type { SddStackMode } from "../../constants/sddStackMode";
import { SddStackModeSwitch } from "../SddStackModeSwitch";

const EMPTY_SDD_SIGNALS: SddSignals = {
  hasTrellisTasks: false,
  hasTrellisSpec: false,
  hasOpenSpec: false,
  hasGenericSpec: false,
};

export interface SddStackModeConfigModalProps {
  open: boolean;
  title: string;
  targetLabel: string;
  value: SddStackMode;
  signals: SddSignals | null;
  saving: boolean;
  canSave: boolean;
  onValueChange: (value: SddStackMode) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function SddStackModeConfigModal({
  open,
  title,
  targetLabel,
  value,
  signals,
  saving,
  canSave,
  onValueChange,
  onCancel,
  onSubmit,
}: SddStackModeConfigModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={onSubmit}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={520}
    >
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text strong>{targetLabel}</Typography.Text>
        <Typography.Text type="secondary" className="app-add-repo-field-label">
          选择内置能力栈；保存时将按选项初始化 .trellis 或安装 OMC 插件。
        </Typography.Text>
        <SddStackModeSwitch
          value={value}
          autoResolved={resolveAutoSddMode(signals ?? EMPTY_SDD_SIGNALS)}
          disabled={!canSave || saving}
          onChange={onValueChange}
          size="small"
        />
      </Space>
    </Modal>
  );
}
