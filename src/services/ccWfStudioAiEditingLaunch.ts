import { invoke } from "@tauri-apps/api/core";
import {
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING,
  type CcWfStudioLaunchAiEditingDetail,
} from "../constants/workflowUiEvents";

export const CC_WF_STUDIO_AI_EDITING_SKILL_NAME = "cc-workflow-ai-editor";

export type CcWfStudioAiEditingProvider =
  | "claude-code"
  | "copilot-cli"
  | "copilot-chat"
  | "codex"
  | "roo-code"
  | "gemini"
  | "antigravity"
  | "cursor";

export interface CcWfStudioMcpBridgeStatus {
  running: boolean;
  port: number | null;
}

export async function writeCcWfStudioAiEditingSkill(
  projectPath: string,
  provider: CcWfStudioAiEditingProvider,
): Promise<void> {
  await invoke<void>("write_cc_wf_studio_ai_editing_skill", { projectPath, provider });
}

export async function ensureCcWfStudioMcpForProject(projectPath: string): Promise<CcWfStudioMcpBridgeStatus> {
  await invoke<void>("ensure_cc_workflow_studio_project_mcp", { projectPath });
  return invoke<CcWfStudioMcpBridgeStatus>("cc_wf_studio_mcp_bridge_status");
}

export function dispatchCcWfStudioLaunchAiEditing(detail: CcWfStudioLaunchAiEditingDetail): void {
  window.dispatchEvent(
    new CustomEvent(WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING, { detail }),
  );
}

export function isWiseSupportedAiEditingProvider(provider: string): provider is CcWfStudioAiEditingProvider {
  return provider === "claude-code";
}

export function wiseAiEditingSlashPrompt(provider: CcWfStudioAiEditingProvider): string {
  switch (provider) {
    case "claude-code":
      return `/${CC_WF_STUDIO_AI_EDITING_SKILL_NAME}`;
    default:
      return `/${CC_WF_STUDIO_AI_EDITING_SKILL_NAME}`;
  }
}
