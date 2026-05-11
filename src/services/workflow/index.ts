import type { WorkflowFacade } from "../../types/workflow";
import { PassThroughGateEngine, StaticTaskRouter } from "./defaults";
import { DefaultWorkflowEngine } from "./engine";
import { LocalWorkflowStore } from "./eventStore";
import { DefaultWorkflowFacade } from "./facade";
import { ClaudeOmcWorkflowAdapter } from "./omcAdapter";

let workflowFacadeSingleton: WorkflowFacade | null = null;

export function getWorkflowFacade(): WorkflowFacade {
  if (workflowFacadeSingleton) return workflowFacadeSingleton;
  const store = new LocalWorkflowStore();
  const router = new StaticTaskRouter();
  const adapter = new ClaudeOmcWorkflowAdapter();
  const gate = new PassThroughGateEngine();
  const engine = new DefaultWorkflowEngine(store, router, adapter, gate);
  workflowFacadeSingleton = new DefaultWorkflowFacade(engine);
  return workflowFacadeSingleton;
}

export * from "./engine";
export * from "./eventStore";
export * from "./facade";
export * from "./replay";

