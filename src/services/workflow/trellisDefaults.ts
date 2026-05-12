import type { WorkflowTemplateItem, WorkflowTemplateStage } from "../../types";

export const TRELLIS_TEAM_TEMPLATE_ID = "trellis-team";
export const TRELLIS_ADAPTER_TEMPLATE_ID = "trellis";

interface TrellisStageDefault {
  name: string;
  agentType: string;
}

const TRELLIS_STAGE_DEFAULTS: readonly TrellisStageDefault[] = [
  { name: "brainstorm", agentType: "analyst" },
  { name: "research", agentType: "trellis-research" },
  { name: "plan", agentType: "planner" },
  { name: "implement", agentType: "trellis-implement" },
  { name: "check", agentType: "trellis-check" },
  { name: "update-spec", agentType: "writer" },
  { name: "finish", agentType: "git-master" },
];

/**
 * Pure factory for the in-memory default Trellis team template.
 * Assignee employeeId carries the agentType as a placeholder so host code
 * can map it to a real employee record before persistence.
 */
export function buildTrellisTeamTemplate(now: number = Date.now()): WorkflowTemplateItem {
  const stages: WorkflowTemplateStage[] = TRELLIS_STAGE_DEFAULTS.map((stage, index) => ({
    id: `trellis-team-stage-${stage.name}`,
    name: stage.name,
    stageOrder: index,
    passRule: "ALL_APPROVE",
    rejectRule: "ANY_REJECT_BACK",
    assignees: [
      {
        id: `trellis-team-assignee-${stage.name}`,
        employeeId: stage.agentType,
        requiredCount: 1,
        isRequired: true,
      },
    ],
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
  return TRELLIS_STAGE_DEFAULTS.map((stage) => stage.name);
}
