import { invoke } from "@tauri-apps/api/core";
import type { EmployeeItem, EmployeeTaskCountItem } from "../types";

export async function listEmployees(): Promise<EmployeeItem[]> {
  return invoke<EmployeeItem[]>("list_employees");
}

export async function createEmployee(input: {
  name: string;
  agentType: string;
  enabled?: boolean;
  repositoryIds?: number[];
}): Promise<EmployeeItem> {
  return invoke<EmployeeItem>("create_employee", {
    name: input.name,
    agentType: input.agentType,
    enabled: input.enabled ?? true,
    repositoryIds: input.repositoryIds ?? [],
  });
}

export async function updateEmployee(input: {
  employeeId: string;
  name: string;
  agentType: string;
  enabled: boolean;
  repositoryIds?: number[];
}): Promise<EmployeeItem> {
  return invoke<EmployeeItem>("update_employee", input);
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  return invoke("delete_employee", { employeeId });
}

export async function listEmployeeTaskCounts(): Promise<EmployeeTaskCountItem[]> {
  return invoke<EmployeeTaskCountItem[]>("list_employee_task_counts");
}

export async function moveEmployeeDisplayOrder(input: {
  employeeId: string;
  direction: "up" | "down";
}): Promise<void> {
  return invoke("move_employee_display_order", input);
}
