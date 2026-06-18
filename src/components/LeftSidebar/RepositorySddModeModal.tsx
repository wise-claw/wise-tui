import type { Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { SddStackModeConfigModal } from "./SddStackModeConfigModal";
import type { SddSignals } from "../../services/sddModeDetector";
import type { SddStackMode } from "../../constants/sddStackMode";

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
    <SddStackModeConfigModal
      open={Boolean(repository)}
      title="仓库 SDD 模式"
      targetLabel={repository ? repositoryFolderBasename(repository) : ""}
      value={value}
      signals={signals}
      saving={saving}
      canSave={canSave}
      onValueChange={onValueChange}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}
