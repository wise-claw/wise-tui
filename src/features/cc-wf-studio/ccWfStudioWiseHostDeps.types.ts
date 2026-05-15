import type { Workflow } from "@cc-workflow-studio-core/workflow-definition";
import type { CcWorkflowListItem } from "../../services/ccWorkflowStudioFiles";
import type { CcWfStudioMcpBridgeStatus } from "../../services/ccWfStudioAiEditingLaunch";

/**
 * Wise 侧注入到 `mountCcWfStudioWiseHost` 的能力面：便于测试替换或与未来其他宿主组合。
 */
export interface CcWfStudioWiseHostDeps {
  listWorkflows(projectPath: string): Promise<CcWorkflowListItem[]>;
  readWorkflowJson(projectPath: string, workflowId: string): Promise<string>;
  writeWorkflowJson(projectPath: string, workflowId: string, json: string): Promise<void>;
  readImportJsonFile(absolutePath: string): Promise<string>;
  buildClaudeSlashMarkdown(workflow: Workflow, highlightEnabled: boolean): string;
  writeProjectRelativeFile(
    repositoryPath: string,
    relativePath: string,
    payload: string,
  ): Promise<void>;
  pickWorkflowJsonFile(defaultDir: string): Promise<string | null>;
  confirmWorkflowOverwrite(name: string): Promise<boolean>;
  mcpBridgeStatus(): Promise<CcWfStudioMcpBridgeStatus>;
  mcpBridgeResolve(args: {
    correlationId: string;
    ok: boolean;
    body: Record<string, unknown> | null;
    err: string | null;
  }): Promise<void>;
  stopMcpBridge(): Promise<void>;
  setMcpReviewBeforeApply(value: boolean): Promise<void>;
  startMcpBridge(projectPath: string): Promise<CcWfStudioMcpBridgeStatus>;
  ensureMcpForProject(projectPath: string): Promise<CcWfStudioMcpBridgeStatus>;
  runAiEditingLaunch(
    repositoryPath: string,
    provider: string,
    opts?: { startMcp?: boolean },
  ): Promise<CcWfStudioMcpBridgeStatus>;
  dispatchMcpSessionEnded(): void;
  dispatchRunInClaudeSession(detail: { repositoryPath: string; slashCommand: string }): void;
}
