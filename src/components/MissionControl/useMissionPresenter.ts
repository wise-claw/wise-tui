import { useMemo, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
import type { UseSplitWizardStateApi } from "../PrdSplitWizard/useSplitWizardState";
import { projectMission } from "./presenter/projectMission";
import type { MissionSelectionInput } from "./presenter/types";

export function useMissionPresenter(input: {
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
}) {
  const [selection, setSelection] = useState<MissionSelectionInput>({
    requirementId: null,
    taskId: null,
  });
  const viewModel = useMemo(
    () =>
      projectMission({
        state: input.api.state,
        selection,
        repositories: input.repositories,
        projects: input.projects,
      }),
    [input.api.state, input.projects, input.repositories, selection],
  );
  return {
    viewModel,
    selection,
    setSelection,
  };
}
