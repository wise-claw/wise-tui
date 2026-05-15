import { Radio, Select, Space } from "antd";
import type { ProjectItem, Repository } from "../../../types";
import type { PrdSplitTargetKind } from "../../PrdSplitWizard/targetModel";
import { COPY } from "../copy";

interface MissionTargetPickerProps {
  targetKind: PrdSplitTargetKind;
  projects: ProjectItem[];
  repositories: Repository[];
  selectedProjectId: string | null;
  selectedRepositoryId: number | null;
  onTargetKindChange: (kind: PrdSplitTargetKind) => void;
  onProjectChange: (projectId: string) => void;
  onRepositoryChange: (repositoryId: number) => void;
}

export function MissionTargetPicker({
  targetKind,
  projects,
  repositories,
  selectedProjectId,
  selectedRepositoryId,
  onTargetKindChange,
  onProjectChange,
  onRepositoryChange,
}: MissionTargetPickerProps) {
  return (
    <Space direction="vertical" size={8} className="mission-target-picker">
      <Radio.Group
        value={targetKind}
        onChange={(event) => onTargetKindChange(event.target.value as PrdSplitTargetKind)}
        optionType="button"
        buttonStyle="solid"
        options={[
          { value: "project", label: COPY.setupDrawer.targetProject },
          { value: "repository", label: COPY.setupDrawer.targetRepository },
        ]}
      />
      {targetKind === "project" ? (
        <Select
          value={selectedProjectId ?? undefined}
          placeholder="选择项目"
          onChange={onProjectChange}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
        />
      ) : (
        <Select
          value={selectedRepositoryId ?? undefined}
          placeholder="选择仓库"
          onChange={onRepositoryChange}
          options={repositories.map((repository) => ({
            value: repository.id,
            label: repository.name,
          }))}
        />
      )}
    </Space>
  );
}
