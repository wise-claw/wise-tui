import {
  mergeWorkspaceTodosPayload,
  parseWorkspaceTodosPayload,
  type WorkspaceTodoItem,
  type WorkspaceTodosPayloadV1,
} from "../types/workspaceTodos";
import {
  listProjectWorkspaceTodosDb,
  listRepositoryWorkspaceTodosDb,
  saveProjectWorkspaceTodosDb,
  saveRepositoryWorkspaceTodosDb,
} from "./workspaceInspectorDb";

export async function loadProjectWorkspaceTodos(projectId: string): Promise<WorkspaceTodosPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  const payload = await listProjectWorkspaceTodosDb(id);
  return parseWorkspaceTodosPayload(JSON.stringify(payload));
}

export async function saveProjectWorkspaceTodos(
  projectId: string,
  items: WorkspaceTodoItem[],
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await saveProjectWorkspaceTodosDb(id, mergeWorkspaceTodosPayload(items).items);
}

export async function loadRepositoryWorkspaceTodos(
  repositoryId: number,
): Promise<WorkspaceTodosPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  const payload = await listRepositoryWorkspaceTodosDb(repositoryId);
  return parseWorkspaceTodosPayload(JSON.stringify(payload));
}

export async function saveRepositoryWorkspaceTodos(
  repositoryId: number,
  items: WorkspaceTodoItem[],
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await saveRepositoryWorkspaceTodosDb(repositoryId, mergeWorkspaceTodosPayload(items).items);
}
