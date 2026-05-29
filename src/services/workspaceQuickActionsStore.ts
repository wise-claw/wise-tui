import {
  mergeWorkspaceQuickActionsPayload,
  parseWorkspaceQuickActionsPayload,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionsPayloadV1,
} from "../types/workspaceQuickActions";
import {
  listProjectWorkspaceQuickActionsDb,
  listRepositoryWorkspaceQuickActionsDb,
  saveProjectWorkspaceQuickActionsDb,
  saveRepositoryWorkspaceQuickActionsDb,
} from "./workspaceInspectorDb";

export async function loadProjectWorkspaceQuickActions(
  projectId: string,
): Promise<WorkspaceQuickActionsPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  const payload = await listProjectWorkspaceQuickActionsDb(id);
  return parseWorkspaceQuickActionsPayload(JSON.stringify(payload));
}

export async function saveProjectWorkspaceQuickActions(
  projectId: string,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  const payload = mergeWorkspaceQuickActionsPayload(items);
  await saveProjectWorkspaceQuickActionsDb(id, payload.items);
}

export async function loadRepositoryWorkspaceQuickActions(
  repositoryId: number,
): Promise<WorkspaceQuickActionsPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  const payload = await listRepositoryWorkspaceQuickActionsDb(repositoryId);
  return parseWorkspaceQuickActionsPayload(JSON.stringify(payload));
}

export async function saveRepositoryWorkspaceQuickActions(
  repositoryId: number,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  const payload = mergeWorkspaceQuickActionsPayload(items);
  await saveRepositoryWorkspaceQuickActionsDb(repositoryId, payload.items);
}

export async function deleteProjectWorkspaceQuickActions(_projectId: string): Promise<void> {
  /* 删除工作区时由 Rust `delete_project_scoped_rows` 级联清理表行。 */
}

export async function deleteRepositoryWorkspaceQuickActions(_repositoryId: number): Promise<void> {
  /* 删除仓库时由 Rust `purge_repository_database_refs` 级联清理表行。 */
}
