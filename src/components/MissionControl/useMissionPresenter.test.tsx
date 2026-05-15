import { describe, expect, test } from "bun:test";
import { create, act } from "react-test-renderer";
import { useLayoutEffect, type Dispatch, type ReactElement, type SetStateAction } from "react";
import type { ProjectItem, Repository } from "../../types";
import { useMissionPresenter } from "./useMissionPresenter";
import type { UseSplitWizardStateApi } from "../PrdSplitWizard/useSplitWizardState";
import type { WizardState } from "../PrdSplitWizard/types";
import type { MissionSelectionInput } from "./presenter/types";
import { emptyWizardState } from "../PrdSplitWizard/types";

const repo: Repository = {
  id: 1,
  name: "web",
  path: "/tmp/web",
  repositoryType: "frontend",
  createdAt: "",
  updatedAt: "",
};

const project: ProjectItem = {
  id: "p",
  name: "Wise",
  rootPath: "/tmp/wise",
  repositoryIds: [1],
  sddMode: "wise_trellis",
  createdAt: 0,
  updatedAt: 0,
};

type MissionPresenterValue = {
  viewModel: ReturnType<typeof useMissionPresenter>["viewModel"];
  selection: MissionSelectionInput;
  setSelection: Dispatch<SetStateAction<MissionSelectionInput>>;
};

function makeApi(state: WizardState): UseSplitWizardStateApi {
  return {
    state,
    reset: () => {},
    setProject: () => {},
    setSelectedRepos: () => {},
    setPrdMarkdown: () => {},
    parseAndPlan: () => ({ ok: true }),
    refreshExistingParents: async () => {},
    setReuseExistingParents: () => {},
    setDispatchOnlyDirty: () => {},
    patchTaskEdit: () => {},
    clearTaskEdit: () => {},
    clearTaskAnchorEdit: () => {},
    deleteTask: () => {},
    restoreTask: () => {},
    addManualTask: () => {},
    removeManualTask: () => {},
    patchManualTask: () => {},
    discardClusterEdits: () => {},
    goToDispatch: () => {},
    setClusterRun: () => {},
    patchClusterRun: () => {},
    goToReview: () => {},
    beginWrite: () => {},
    addWriteResult: () => {},
    setWorkflowGraphResult: () => {},
    finishWrite: () => {},
    failWrite: () => {},
    setGlobalError: () => {},
    backToInput: () => {},
    backToPlan: () => {},
    backToDispatch: () => {},
    reassignRequirement: () => {},
    undoReassign: () => {},
    addManualCluster: () => {},
    renameCluster: () => {},
    resetClusterPlanEdits: () => {},
  };
}

function HookProbe({
  api,
  projects,
  repositories,
  onValue,
}: {
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
  onValue: (value: MissionPresenterValue) => void;
}): ReactElement | null {
  const value = useMissionPresenter({ api, projects, repositories });
  useLayoutEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

describe("useMissionPresenter", () => {
  test("projects state into a stable mission view model and preserves selection updates", () => {
    const state = emptyWizardState();
    const api = makeApi(state);
    let current: MissionPresenterValue | null = null;

    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(
        <HookProbe
          api={api}
          projects={[project]}
          repositories={[repo]}
          onValue={(value) => {
            current = value;
          }}
        />,
      );
    });

    expect(current?.viewModel.phase).toBe("drafting");
    expect(current?.selection).toEqual({ requirementId: null, taskId: null });

    act(() => {
      current?.setSelection({ requirementId: "REQ-1", taskId: "T-1" } satisfies MissionSelectionInput);
    });

    expect(current?.selection).toEqual({ requirementId: "REQ-1", taskId: "T-1" });
    expect(current?.viewModel.selection.taskId).toBe("T-1");

    renderer?.unmount();
  });
});
