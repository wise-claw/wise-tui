import type { ProjectItem } from "../../types";
import { SddStackModeConfigModal } from "./SddStackModeConfigModal";
import type { SddSignals } from "../../services/trellis/sddModeDetector";
import type { SddStackMode } from "../../constants/sddStackMode";

interface WorkspaceSddModeModalProps {
  project: ProjectItem | null;
  value: SddStackMode;
  signals: SddSignals | null;
  saving: boolean;
  canSave: boolean;
  onValueChange: (value: SddStackMode) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkspaceSddModeModal({
  project,
  value,
  signals,
  saving,
  canSave,
  onValueChange,
  onCancel,
  onSubmit,
}: WorkspaceSddModeModalProps) {
  return (
    <SddStackModeConfigModal
      open={Boolean(project)}
      title="工作区 SDD 模式"
      targetLabel={project?.name ?? ""}
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
