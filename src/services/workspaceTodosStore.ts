import {
  createWorkspaceTodoItem,
  mergeWorkspaceTodosPayload,
  type WorkspaceTodoItem,
  type WorkspaceTodosPayloadV1,
} from "../types/workspaceTodos";
import { dispatchWorkspaceTodosChanged } from "../constants/workspaceTodosEvents";
import {
  listGlobalWorkspaceTodosDb,
  saveGlobalWorkspaceTodosDb,
} from "./workspaceInspectorDb";

export async function loadGlobalWorkspaceTodos(): Promise<WorkspaceTodosPayloadV1> {
  return listGlobalWorkspaceTodosDb();
}

export async function saveGlobalWorkspaceTodos(items: WorkspaceTodoItem[]): Promise<void> {
  await saveGlobalWorkspaceTodosDb(mergeWorkspaceTodosPayload(items).items);
}

function incompleteWorkspaceTodoCount(items: WorkspaceTodoItem[]): number {
  return items.reduce((count, item) => (item.completed ? count : count + 1), 0);
}

export async function appendGlobalWorkspaceTodoItem(title: string): Promise<void> {
  const item = createWorkspaceTodoItem(title);
  const payload = await loadGlobalWorkspaceTodos();
  const items = [...payload.items, item];
  await saveGlobalWorkspaceTodos(items);
  dispatchWorkspaceTodosChanged({
    incompleteCount: incompleteWorkspaceTodoCount(items),
    reloadItems: true,
  });
}
