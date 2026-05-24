import { Modal, Space, Typography } from "antd";
import type { Repository } from "../../types";
import { resolveAutoSddMode, type SddSignals } from "../../services/trellis/sddModeDetector";
import type { SddStackMode } from "../../constants/sddStackMode";
import { SddStackModeSwitch } from "../SddStackModeSwitch";
import { repositoryFolderBasename } from "../../utils/repositoryType";

interface RepositorySddModeModalProps {
  repository: Repository | null;
  value: SddStackMode;
  signals: SddSignals | null;
  saving: boolean;
  canSave: boolean;
  onValueChange: (value: SddStackMode) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RepositorySddModeModal({
  repository,
  value,
  signals,
  saving,
  canSave,
  onValueChange,
  onCancel,
  onSubmit,
}: RepositorySddModeModalProps) {
  return (
    <Modal
      title="仓库 SDD 模式"
      open={Boolean(repository)}
      onCancel={onCancel}
      onOk={onSubmit}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={520}
    >
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text strong>
          {repository ? repositoryFolderBasename(repository) : ""}
        </Typography.Text>
        <Typography.Text type="secondary" className="app-add-repo-field-label">
          选择内置能力栈；保存时将按选项初始化 .trellis 或安装 OMC 插件。
        </Typography.Text>
        <SddStackModeSwitch
          value={value}
          autoResolved={resolveAutoSddMode(
            signals ?? {
              hasTrellisTasks: false,
              hasTrellisSpec: false,
              hasOpenSpec: false,
              hasGenericSpec: false,
            },
          )}
          disabled={!canSave || saving}
          onChange={onValueChange}
          size="small"
        />
      </Space>
    </Modal>
  );
}
