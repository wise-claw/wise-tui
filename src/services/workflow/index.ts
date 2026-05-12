import type { WorkflowFacade } from "../../types/workflow";
import { DefaultAdapterRegistry } from "./adapterRegistry";
import { PassThroughGateEngine, StaticTaskRouter } from "./defaults";
import { DefaultWorkflowEngine } from "./engine";
import { LocalWorkflowStore } from "./eventStore";
import { DefaultWorkflowFacade } from "./facade";
import { ClaudeOmcWorkflowAdapter } from "./omcAdapter";
import { TRELLIS_TEMPLATE_ID, TrellisWorkflowAdapter } from "./trellisAdapter";

let workflowFacadeSingleton: WorkflowFacade | null = null;

export function getWorkflowFacade(): WorkflowFacade {
  if (workflowFacadeSingleton) return workflowFacadeSingleton;
  const store = new LocalWorkflowStore();
  const router = new StaticTaskRouter();
  const adapter = new ClaudeOmcWorkflowAdapter();
  const trellisAdapter = new TrellisWorkflowAdapter();
  const registry = DefaultAdapterRegistry.of(adapter, [[TRELLIS_TEMPLATE_ID, trellisAdapter]]);
  const gate = new PassThroughGateEngine();
  const engine = new DefaultWorkflowEngine(store, router, adapter, gate, registry);
  workflowFacadeSingleton = new DefaultWorkflowFacade(engine);
  return workflowFacadeSingleton;
}

export * from "./adapterRegistry";
export * from "./engine";
export * from "./eventStore";
export * from "./facade";
export * from "./replay";
export * from "./trellisAdapter";
export * from "./trellisDefaults";

