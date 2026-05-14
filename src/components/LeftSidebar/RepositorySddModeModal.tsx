import { Modal, Space, Typography } from "antd";
import type { Repository, SddMode } from "../../types";
import { resolveAutoSddMode, type SddSignals } from "../../services/trellis/sddModeDetector";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { SddModeSwitch } from "../SddModeSwitch";

interface RepositorySddModeModalProps {
  repository: Repository | null;
  value: SddMode;
  signals: SddSignals | null;
  saving: boolean;
  canSave: boolean;
  onValueChange: (value: SddMode) => void;
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
      width={460}
    >
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Typography.Text strong>
          {repository ? repositoryFolderBasename(repository) : ""}
        </Typography.Text>
        <SddModeSwitch
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
