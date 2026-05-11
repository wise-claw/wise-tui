import type { GateCheckBatchDTO, GateEngine, GateType, OmcWorkflowAdapter, RunGateChecksInput, TaskRouter } from "../../types/workflow";

export class StaticTaskRouter implements TaskRouter {
  async routeTask(input: { workflowRunId: string; taskId: string }) {
    void input.workflowRunId;
    const normalizedTaskId = input.taskId.toLowerCase();
    const isVerify = normalizedTaskId.includes("verify") || normalizedTaskId.includes("review");
    const isQa = normalizedTaskId.includes("qa") || normalizedTaskId.includes("test");
    const isTeam = normalizedTaskId.includes("team") || normalizedTaskId.includes("parallel");
    const templateId = isTeam ? "team" : isVerify ? "verify" : isQa ? "ultraqa" : "autopilot";
    const gatePlan: GateType[] =
      templateId === "verify"
        ? ["review", "test"]
        : templateId === "ultraqa"
          ? ["test", "lint", "review"]
          : templateId === "team"
            ? ["build", "test", "review"]
            : ["build", "test"];
    return {
      templateId,
      subagentType: templateId === "team" ? "team" : "executor",
      gatePlan,
      priority: templateId === "verify" ? 80 : templateId === "ultraqa" ? 70 : templateId === "team" ? 75 : 50,
      rationale: [`task ${input.taskId} routed to ${templateId}`],
    };
  }
}

export class NoopOmcWorkflowAdapter implements OmcWorkflowAdapter {
  async execute(input: {
    workflowRunId: string;
    repositoryPath: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    attempt: number;
  }) {
    void input.workflowRunId;
    void input.repositoryPath;
    void input.sessionId;
    return {
      status: "succeeded" as const,
      artifactRefs: [`artifact://${input.taskId}/${input.templateId}/attempt-${input.attempt}`],
      summary: `Executed by ${input.subagentType ?? "main_agent"}`,
    };
  }
}

export class PassThroughGateEngine implements GateEngine {
  async runChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO> {
    const checks = (input.gateTypes ?? ["build", "test"]).map((gateType) => ({
      gateType,
      passed: true,
      durationMs: 0,
      evidenceRefs: [`gate://${input.workflowRunId}/${gateType}`],
    }));
    return {
      workflowRunId: input.workflowRunId,
      stage: input.stage,
      taskId: input.taskId,
      checks,
      allPassed: checks.every((check) => check.passed),
      checkedAt: Date.now(),
    };
  }
}

