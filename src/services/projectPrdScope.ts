import { invoke } from "@tauri-apps/api/core";

export async function listProjectPrdEmployeeIds(projectId: string): Promise<string[]> {
  return invoke<string[]>("list_project_prd_employee_ids", { projectId });
}

export async function listProjectPrdWorkflowIds(projectId: string): Promise<string[]> {
  return invoke<string[]>("list_project_prd_workflow_ids", { projectId });
}

export async function addProjectPrdEmployee(projectId: string, employeeId: string): Promise<void> {
  await invoke("add_project_prd_employee", { projectId, employeeId });
}

export async function removeProjectPrdEmployee(projectId: string, employeeId: string): Promise<void> {
  await invoke("remove_project_prd_employee", { projectId, employeeId });
}

export async function addProjectPrdWorkflow(projectId: string, workflowId: string): Promise<void> {
  await invoke("add_project_prd_workflow", { projectId, workflowId });
}

export async function removeProjectPrdWorkflow(projectId: string, workflowId: string): Promise<void> {
  await invoke("remove_project_prd_workflow", { projectId, workflowId });
}
