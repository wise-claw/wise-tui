import type { WorkflowTemplateItem, WorkflowTemplateStage } from "../../types";

export const TRELLIS_TEAM_TEMPLATE_ID = "trellis-team";
export const TRELLIS_ADAPTER_TEMPLATE_ID = "trellis";

export interface TrellisStageRoute {
  name: string;
  subagentType: string;
}

const TRELLIS_STAGE_ROUTES: readonly TrellisStageRoute[] = [
  { name: "brainstorm", subagentType: "trellis-continue" },
  { name: "research", subagentType: "trellis-research" },
  { name: "plan", subagentType: "trellis-continue" },
  { name: "implement", subagentType: "trellis-implement" },
  { name: "check", subagentType: "trellis-check" },
  { name: "update-spec", subagentType: "trellis-continue" },
  { name: "finish", subagentType: "trellis-continue" },
];

/**
 * Pure factory for the in-memory default Trellis team template.
 * Trellis stage routing is repository-owned, so this template must not write
 * sub-agent names into WorkflowTemplateAssignee.employeeId.
 */
export function buildTrellisTeamTemplate(now: number = Date.now()): WorkflowTemplateItem {
  const stages: WorkflowTemplateStage[] = TRELLIS_STAGE_ROUTES.map((stage, index) => ({
    id: `trellis-team-stage-${stage.name}`,
    name: stage.name,
    stageOrder: index,
    passRule: "ALL_APPROVE",
    rejectRule: "ANY_REJECT_BACK",
    assignees: [],
  }));
  return {
    id: TRELLIS_TEAM_TEMPLATE_ID,
    name: "trellis-team",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    stages,
  };
}

export function trellisStageNames(): readonly string[] {
  return TRELLIS_STAGE_ROUTES.map((stage) => stage.name);
}

export function trellisStageRoutes(): readonly TrellisStageRoute[] {
  return TRELLIS_STAGE_ROUTES;
}

export function resolveTrellisSubagentForStage(stageName: string): string | undefined {
  const normalized = stageName.trim();
  if (!normalized) return undefined;
  return TRELLIS_STAGE_ROUTES.find((stage) => stage.name === normalized)?.subagentType;
}
