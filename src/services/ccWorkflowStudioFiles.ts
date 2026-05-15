import { invoke } from "@tauri-apps/api/core";

export interface CcWorkflowListItem {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
}

export async function listCcWorkflowStudioWorkflows(projectPath: string): Promise<CcWorkflowListItem[]> {
  return invoke<CcWorkflowListItem[]>("list_cc_workflow_studio_workflows", { projectPath });
}

export async function readCcWorkflowStudioWorkflow(
  projectPath: string,
  workflowId: string,
): Promise<string> {
  return invoke<string>("read_cc_workflow_studio_workflow", { projectPath, workflowId });
}

export async function writeCcWorkflowStudioWorkflow(
  projectPath: string,
  workflowId: string,
  payload: string,
): Promise<void> {
  await invoke<void>("write_cc_workflow_studio_workflow", { projectPath, workflowId, payload });
}

/** 读取用户通过文件对话框选择的 JSON 文件内容（绝对路径，上限 8MB）。 */
export async function readCcWorkflowStudioImportFile(absolutePath: string): Promise<string> {
  return invoke<string>("read_cc_workflow_studio_import_file", { absolutePath });
}
