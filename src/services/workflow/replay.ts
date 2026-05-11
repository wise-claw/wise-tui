import type { WorkflowEventEnvelope, WorkflowRunDTO } from "../../types/workflow";

function withUpdatedAt(run: WorkflowRunDTO, timestamp: number): WorkflowRunDTO {
  return { ...run, updatedAt: Math.max(run.updatedAt, timestamp) };
}

function ensureTask(run: WorkflowRunDTO, taskId: string, timestamp: number): WorkflowRunDTO {
  if (run.tasks.some((task) => task.taskId === taskId)) return run;
  return {
    ...run,
    tasks: [
      ...run.tasks,
      {
        taskId,
        flowStatus: "todo",
        runState: "idle",
        artifactRefs: [],
        gateSummary: { required: [], passed: [], failed: [] },
        updatedAt: timestamp,
      },
    ],
  };
}

export function replayWorkflowRun(base: WorkflowRunDTO, events: WorkflowEventEnvelope[]): WorkflowRunDTO {
  return events.reduce((run, event) => {
    switch (event.eventType) {
      case "stage.entered": {
        const stage = String((event.payload as { stage?: string }).stage ?? "");
        if (!stage) return run;
        return withUpdatedAt({ ...run, currentStage: stage as WorkflowRunDTO["currentStage"] }, event.timestamp);
      }
      case "workflow.completed": {
        return withUpdatedAt({ ...run, status: "completed" }, event.timestamp);
      }
      case "workflow.failed": {
        return withUpdatedAt({ ...run, status: "failed" }, event.timestamp);
      }
      case "task.status.changed": {
        const payload = event.payload as { taskId?: string; to?: string };
        if (!payload.taskId || !payload.to) return run;
        const ensured = ensureTask(run, payload.taskId, event.timestamp);
        return withUpdatedAt(
          {
            ...ensured,
            tasks: ensured.tasks.map((task) =>
              task.taskId === payload.taskId ? { ...task, flowStatus: payload.to as typeof task.flowStatus, updatedAt: event.timestamp } : task,
            ),
          },
          event.timestamp,
        );
      }
      case "task.run.started": {
        const payload = event.payload as { taskId?: string; templateId?: string; attempt?: number };
        if (!payload.taskId) return run;
        const ensured = ensureTask(run, payload.taskId, event.timestamp);
        return withUpdatedAt(
          {
            ...ensured,
            tasks: ensured.tasks.map((task) =>
              task.taskId === payload.taskId
                ? {
                    ...task,
                    runState: "running",
                    flowStatus: "in_progress",
                    latestTemplateId: payload.templateId ?? task.latestTemplateId,
                    latestAttempt: payload.attempt ?? task.latestAttempt,
                    updatedAt: event.timestamp,
                  }
                : task,
            ),
          },
          event.timestamp,
        );
      }
      case "task.run.progressed": {
        const payload = event.payload as {
          taskId?: string;
          message?: string;
          stage?: string;
          level?: string;
          metadata?: Record<string, unknown>;
        };
        if (!payload.taskId) return run;
        const ensured = ensureTask(run, payload.taskId, event.timestamp);
        return withUpdatedAt(
          {
            ...ensured,
            tasks: ensured.tasks.map((task) => {
              if (task.taskId !== payload.taskId) return task;
              const metadata = payload.metadata ?? {};
              const omcCommand =
                typeof metadata.omcCommand === "string"
                  ? metadata.omcCommand
                  : task.latestOmcCommand;
              const nextSummary =
                payload.message && payload.message.trim().length > 0
                  ? payload.message
                  : task.latestSummary;
              return {
                ...task,
                runState: "running",
                flowStatus: "in_progress",
                latestSummary: nextSummary,
                latestOmcCommand: omcCommand,
                updatedAt: event.timestamp,
              };
            }),
          },
          event.timestamp,
        );
      }
      case "task.run.succeeded":
      case "task.run.failed":
      case "task.run.aborted": {
        const payload = event.payload as {
          taskId?: string;
          summary?: string;
          error?: string;
          attempt?: number;
          templateId?: string;
          omcCommand?: string;
          artifactRefs?: string[];
        };
        if (!payload.taskId) return run;
        const ensured = ensureTask(run, payload.taskId, event.timestamp);
        const runState = event.eventType === "task.run.succeeded" ? "succeeded" : event.eventType === "task.run.aborted" ? "aborted" : "failed";
        const flowStatus = event.eventType === "task.run.succeeded" ? "pending_review" : "blocked";
        return withUpdatedAt(
          {
            ...ensured,
            tasks: ensured.tasks.map((task) =>
              task.taskId === payload.taskId
                ? {
                    ...task,
                    runState,
                    flowStatus,
                    latestSummary: payload.summary || task.latestSummary,
                    latestError: payload.error || task.latestError,
                    latestAttempt: payload.attempt ?? task.latestAttempt,
                    latestTemplateId: payload.templateId ?? task.latestTemplateId,
                    latestOmcCommand: payload.omcCommand ?? task.latestOmcCommand,
                    artifactRefs: Array.isArray(payload.artifactRefs) ? payload.artifactRefs : task.artifactRefs,
                    updatedAt: event.timestamp,
                  }
                : task,
            ),
          },
          event.timestamp,
        );
      }
      case "artifact.recorded": {
        const payload = event.payload as { taskId?: string; artifactRef?: string };
        const artifactRef = payload.artifactRef;
        if (!payload.taskId || !artifactRef) return run;
        const ensured = ensureTask(run, payload.taskId, event.timestamp);
        return withUpdatedAt(
          {
            ...ensured,
            tasks: ensured.tasks.map((task) =>
              task.taskId === payload.taskId
                ? {
                    ...task,
                    artifactRefs: task.artifactRefs.includes(artifactRef)
                      ? task.artifactRefs
                      : [...task.artifactRefs, artifactRef],
                    updatedAt: event.timestamp,
                  }
                : task,
            ),
          },
          event.timestamp,
        );
      }
      default:
        return withUpdatedAt(run, event.timestamp);
    }
  }, base);
}

