import type { ReactNode } from "react";
import * as missionBackend from "../../../services/missionControlBackend";
import type { MissionReassignPreview } from "../../../services/missionControlBackend";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import { ReassignPreviewBlock } from "../details/ReassignPreviewBlock";

export interface ReassignRequirementFlowDeps {
  previewRequirementReassign: typeof missionBackend.previewRequirementReassign;
  commitRequirementReassign: typeof missionBackend.commitRequirementReassign;
  recordMissionAgentCommand: typeof missionBackend.recordMissionAgentCommand;
  confirm: (input: ReassignConfirmInput) => void;
  success: (content: string) => void;
  error: (content: string) => void;
}

export interface ReassignConfirmInput {
  title: string;
  content: ReactNode;
  okText: string;
  okType: "primary" | "danger";
  cancelText: string;
  onOk: () => Promise<void>;
}

export const reassignRequirementFlowDeps: ReassignRequirementFlowDeps = {
  previewRequirementReassign: missionBackend.previewRequirementReassign,
  commitRequirementReassign: missionBackend.commitRequirementReassign,
  recordMissionAgentCommand: missionBackend.recordMissionAgentCommand,
  confirm: () => {},
  success: () => {},
  error: () => {},
};

export async function moveRequirementWithImpactPreview(
  input: {
    api: Pick<
      UseSplitWizardStateApi,
      "state" | "reassignRequirement" | "markClusterNeedsResplit"
    >;
    missionId: string | null;
    requirementId: string;
    targetClusterId: string;
  },
  deps: ReassignRequirementFlowDeps = reassignRequirementFlowDeps,
): Promise<void> {
  const missionId = input.missionId?.trim() || null;
  if (!missionId) {
    input.api.reassignRequirement(input.requirementId, input.targetClusterId);
    deps.success("需求已重新分配");
    return;
  }

  let preview: MissionReassignPreview;
  try {
    preview = await deps.previewRequirementReassign({
      missionId,
      requirementId: input.requirementId,
      targetClusterId: input.targetClusterId,
    });
  } catch (error) {
    deps.error(`影响预览失败：${toErrorMessage(error)}`);
    return;
  }

  deps.confirm({
    title: "确认调整需求归属？",
    content: <ReassignPreviewBlock preview={preview} />,
    okText: "确认移动",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      await deps.commitRequirementReassign({
        missionId,
        previewId: preview.previewId,
        origin: "mission-control",
      });
      input.api.reassignRequirement(input.requirementId, input.targetClusterId);
      for (const clusterId of preview.affectedClusters) {
        input.api.markClusterNeedsResplit(clusterId);
      }
      await Promise.all(
        preview.agentImpacts.map((agent) =>
          deps.recordMissionAgentCommand({
            missionId,
            commandType: "cancel",
            targetKind: "assignment",
            targetId: agent.assignmentId,
            assignmentId: agent.assignmentId,
            result: {
              source: "requirement_reassign",
              recommendedAction: agent.recommendedAction,
              clusterId: agent.clusterId ?? null,
              taskId: agent.taskId ?? null,
            },
          }),
        ),
      );
      deps.success("需求已重新分配，受影响分组已标记为需重新拆分");
    },
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
