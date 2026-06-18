import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceTodoItem, WorkspaceTodosPayloadV1 } from "../types/workspaceTodos";
import type {
  WorkspaceQuickActionItem,
  WorkspaceQuickActionsPayloadV1,
} from "../types/workspaceQuickActions";

function normalizeQuickActionsPayload(
  raw: WorkspaceQuickActionsPayloadV1 | null | undefined,
): WorkspaceQuickActionsPayloadV1 {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.items)) {
    return { version: 1, items: [] };
  }
  return raw;
}

export async function listProjectWorkspaceQuickActionsDb(
  projectId: string,
): Promise<WorkspaceQuickActionsPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  const payload = await invoke<WorkspaceQuickActionsPayloadV1>("list_project_workspace_quick_actions", {
    projectId: id,
  });
  return normalizeQuickActionsPayload(payload);
}

export async function saveProjectWorkspaceQuickActionsDb(
  projectId: string,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await invoke("save_project_workspace_quick_actions", { projectId: id, items });
}

export async function listRepositoryWorkspaceQuickActionsDb(
  repositoryId: number,
): Promise<WorkspaceQuickActionsPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  const payload = await invoke<WorkspaceQuickActionsPayloadV1>(
    "list_repository_workspace_quick_actions",
    { repositoryId },
  );
  return normalizeQuickActionsPayload(payload);
}

export async function saveRepositoryWorkspaceQuickActionsDb(
  repositoryId: number,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await invoke("save_repository_workspace_quick_actions", { repositoryId, items });
}

function normalizeTodosPayload(
  raw: WorkspaceTodosPayloadV1 | null | undefined,
): WorkspaceTodosPayloadV1 {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.items)) {
    return { version: 1, items: [] };
  }
  return raw;
}

export async function listProjectWorkspaceTodosDb(projectId: string): Promise<WorkspaceTodosPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  const payload = await invoke<WorkspaceTodosPayloadV1>("list_project_workspace_todos", {
    projectId: id,
  });
  return normalizeTodosPayload(payload);
}

export async function saveProjectWorkspaceTodosDb(
  projectId: string,
  items: WorkspaceTodoItem[],
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await invoke("save_project_workspace_todos", { projectId: id, items });
}

export async function listRepositoryWorkspaceTodosDb(
  repositoryId: number,
): Promise<WorkspaceTodosPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  const payload = await invoke<WorkspaceTodosPayloadV1>("list_repository_workspace_todos", {
    repositoryId,
  });
  return normalizeTodosPayload(payload);
}

export async function saveRepositoryWorkspaceTodosDb(
  repositoryId: number,
  items: WorkspaceTodoItem[],
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await invoke("save_repository_workspace_todos", { repositoryId, items });
}
