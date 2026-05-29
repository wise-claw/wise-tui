import {
  mergeWorkspaceMemosPayload,
  parseWorkspaceMemosPayload,
  type WorkspaceMemoItem,
  type WorkspaceMemosPayloadV1,
} from "../types/workspaceMemos";
import {
  listProjectWorkspaceMemosDb,
  listRepositoryWorkspaceMemosDb,
  saveProjectWorkspaceMemosDb,
  saveRepositoryWorkspaceMemosDb,
} from "./workspaceInspectorDb";

export async function loadProjectWorkspaceMemos(projectId: string): Promise<WorkspaceMemosPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  const payload = await listProjectWorkspaceMemosDb(id);
  return parseWorkspaceMemosPayload(JSON.stringify(payload));
}

export async function saveProjectWorkspaceMemos(
  projectId: string,
  items: WorkspaceMemoItem[],
  lastSelectedId?: string | null,
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  const payload = mergeWorkspaceMemosPayload(items, lastSelectedId);
  await saveProjectWorkspaceMemosDb(id, payload.items, payload.lastSelectedId);
}

export async function loadRepositoryWorkspaceMemos(
  repositoryId: number,
): Promise<WorkspaceMemosPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  const payload = await listRepositoryWorkspaceMemosDb(repositoryId);
  return parseWorkspaceMemosPayload(JSON.stringify(payload));
}

export async function saveRepositoryWorkspaceMemos(
  repositoryId: number,
  items: WorkspaceMemoItem[],
  lastSelectedId?: string | null,
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  const payload = mergeWorkspaceMemosPayload(items, lastSelectedId);
  await saveRepositoryWorkspaceMemosDb(repositoryId, payload.items, payload.lastSelectedId);
}

export async function deleteProjectWorkspaceMemos(_projectId: string): Promise<void> {
  /* 删除工作区时由 Rust 级联清理。 */
}

export async function deleteRepositoryWorkspaceMemos(_repositoryId: number): Promise<void> {
  /* 删除仓库时由 Rust 级联清理。 */
}
