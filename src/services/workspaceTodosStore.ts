import {
  createWorkspaceTodoItem,
  mergeWorkspaceTodosPayload,
  parseWorkspaceTodosPayload,
  type WorkspaceTodoItem,
  type WorkspaceTodoScope,
  type WorkspaceTodosPayloadV1,
} from "../types/workspaceTodos";
import { dispatchWorkspaceTodosChanged } from "../constants/workspaceTodosEvents";
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

function incompleteWorkspaceTodoCount(items: WorkspaceTodoItem[]): number {
  return items.reduce((count, item) => (item.completed ? count : count + 1), 0);
}

export async function appendWorkspaceTodoItem(input: {
  scope: WorkspaceTodoScope;
  projectId?: string | null;
  repositoryId?: number | null;
  title: string;
}): Promise<void> {
  const item = createWorkspaceTodoItem(input.title);
  if (input.scope === "project") {
    const projectId = input.projectId?.trim();
    if (!projectId) throw new Error("请选择工作区");
    const payload = await loadProjectWorkspaceTodos(projectId);
    const items = [...payload.items, item];
    await saveProjectWorkspaceTodos(projectId, items);
    dispatchWorkspaceTodosChanged({
      projectId,
      repositoryId: null,
      incompleteCount: incompleteWorkspaceTodoCount(items),
    });
    return;
  }

  const repositoryId = input.repositoryId;
  if (repositoryId == null || !Number.isFinite(repositoryId)) {
    throw new Error("请选择仓库");
  }
  const payload = await loadRepositoryWorkspaceTodos(repositoryId);
  const items = [...payload.items, item];
  await saveRepositoryWorkspaceTodos(repositoryId, items);
  dispatchWorkspaceTodosChanged({
    projectId: null,
    repositoryId,
    incompleteCount: incompleteWorkspaceTodoCount(items),
  });
}
