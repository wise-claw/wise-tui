import { invoke } from "@tauri-apps/api/core";
import type { WorkflowTemplateItem, WorkflowTemplateStage } from "../types";

export async function listWorkflowTemplates(): Promise<WorkflowTemplateItem[]> {
  return invoke<WorkflowTemplateItem[]>("list_workflow_templates");
}

export async function saveWorkflowTemplate(input: {
  workflowId?: string;
  name: string;
  isDefault: boolean;
  stages: WorkflowTemplateStage[];
}): Promise<WorkflowTemplateItem> {
  return invoke<WorkflowTemplateItem>("save_workflow_template", input);
}

export async function deleteWorkflowTemplate(workflowId: string): Promise<void> {
  return invoke("delete_workflow_template", { workflowId });
}
